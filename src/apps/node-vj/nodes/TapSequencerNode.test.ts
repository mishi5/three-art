import { expect, test, describe } from "bun:test";
import { TapSequencerNode, TapSequencerRuntime } from "./TapSequencerNode";
import type { EvalContext } from "../graph/node-type";
import type { NodeInstance } from "../graph/graph-doc";

/** evaluate 用の最小 EvalContext（TapSequencer は入力/param を使わない）。 */
function ctxAt(timeSec: number, state: TapSequencerRuntime | undefined): EvalContext {
  const node: NodeInstance = { id: "n1", type: "TapSequencer", params: {} };
  return {
    timeSec,
    input: () => undefined,
    param: () => undefined,
    node,
    state,
  };
}

describe("#204 TapSequencerNode 定義", () => {
  test("generator カテゴリ・tapSequencer フラグ・trigger 出力のみ", () => {
    expect(TapSequencerNode.type).toBe("TapSequencer");
    expect(TapSequencerNode.category).toBe("control");
    expect(TapSequencerNode.tapSequencer).toBe(true);
    expect(TapSequencerNode.inputs).toEqual([]);
    expect(TapSequencerNode.outputs.map((o) => o.id)).toEqual(["trigger"]);
    expect(TapSequencerNode.outputs[0]!.type).toBe("trigger");
    expect(TapSequencerNode.params).toEqual([]);
  });

  test("createState は TapSequencerRuntime を返す", () => {
    const s = TapSequencerNode.createState!(undefined as never);
    expect(s).toBeInstanceOf(TapSequencerRuntime);
  });
});

describe("#204 TapSequencerRuntime 状態遷移", () => {
  test("初期は idle・記録なし", () => {
    const rt = new TapSequencerRuntime();
    expect(rt.status().phase).toBe("idle");
    expect(rt.status().tapCount).toBe(0);
  });

  test("startRecording → recording・stopRecording（タップあり）→ playing", () => {
    const rt = new TapSequencerRuntime();
    rt.startRecording(10);
    expect(rt.status().phase).toBe("recording");
    rt.tap(10.5);
    rt.tap(11.0);
    rt.stopRecording(12);
    const st = rt.status();
    expect(st.phase).toBe("playing");
    expect(st.tapCount).toBe(2);
    expect(st.loopLenSec).toBe(2); // ループ長＝ボタンを押していた時間
  });

  test("タップ 0 回で停止 → idle（再生しない）", () => {
    const rt = new TapSequencerRuntime();
    rt.startRecording(10);
    rt.stopRecording(12);
    expect(rt.status().phase).toBe("idle");
    expect(rt.status().tapCount).toBe(0);
  });

  test("再録音: playing 中の startRecording で前の記録を破棄する", () => {
    const rt = new TapSequencerRuntime();
    rt.startRecording(0);
    rt.tap(0.5);
    rt.stopRecording(1);
    expect(rt.status().phase).toBe("playing");
    rt.startRecording(5);
    const st = rt.status();
    expect(st.phase).toBe("recording");
    expect(st.tapCount).toBe(0);
    expect(st.loopLenSec).toBe(0);
  });

  test("clear: 記録消去・再生停止して idle に戻る", () => {
    const rt = new TapSequencerRuntime();
    rt.startRecording(0);
    rt.tap(0.5);
    rt.stopRecording(1);
    rt.clear();
    expect(rt.status().phase).toBe("idle");
    expect(rt.status().tapCount).toBe(0);
    expect(rt.status().loopLenSec).toBe(0);
  });

  test("recording 以外での tap / stopRecording は無視される", () => {
    const rt = new TapSequencerRuntime();
    rt.tap(1); // idle 中
    expect(rt.status().tapCount).toBe(0);
    expect(rt.consumeTapTrigger()).toBe(false);
    rt.stopRecording(2); // idle 中
    expect(rt.status().phase).toBe("idle");
  });

  test("status: recording 中は録音経過秒、playing 中は再生位置を返す", () => {
    const rt = new TapSequencerRuntime();
    rt.startRecording(10);
    rt.tap(10.5);
    expect(rt.status(11.2).recordElapsedSec).toBeCloseTo(1.2);
    rt.stopRecording(12);
    // playing: 最初の evaluate で anchor が張られてから位置が進む。
    rt.playStep(100);   // anchor
    rt.playStep(100.5);
    expect(rt.status().playPosSec).toBeCloseTo(0.5);
    rt.playStep(102.5); // 2s ループを 1 周して 0.5
    expect(rt.status().playPosSec).toBeCloseTo(0.5);
  });
});

describe("#204 evaluate: 録音中タップの即時発火", () => {
  test("タップしたフレームだけ trigger=true・次フレームは false", () => {
    const rt = new TapSequencerRuntime();
    rt.startRecording(0);
    rt.tap(0.3);
    expect(TapSequencerNode.evaluate(ctxAt(0.31, rt))).toEqual({ trigger: true });
    expect(TapSequencerNode.evaluate(ctxAt(0.32, rt))).toEqual({ trigger: false });
  });

  test("state 未生成は false", () => {
    expect(TapSequencerNode.evaluate(ctxAt(0, undefined))).toEqual({ trigger: false });
  });
});

describe("#204 evaluate: 再生（ループ発火）", () => {
  /** 録音 0..2s・タップ 0.55s / 1.45s のシーケンスを作る（評価の 0.1s 刻みと重ねない）。 */
  function recorded(): TapSequencerRuntime {
    const rt = new TapSequencerRuntime();
    rt.startRecording(0);
    rt.tap(0.55);
    rt.tap(1.45);
    rt.stopRecording(2);
    rt.consumeTapTrigger(); // 録音中ラッチを消費しておく
    return rt;
  }

  test("記録タイミングに従って発火し、ループで繰り返す", () => {
    const rt = recorded();
    const fires: number[] = [];
    // 10 秒ぶんを 0.1s 刻みで評価（anchor=100）。
    for (let t = 100; t <= 110.001; t += 0.1) {
      const out = TapSequencerNode.evaluate(ctxAt(t, rt));
      if (out.trigger) fires.push(Math.round((t - 100) * 10) / 10);
    }
    // 0.55/1.45 ± ループ 2s の繰り返し（タップ直後のフレームで 1 回ずつ）。
    expect(fires).toEqual([0.6, 1.5, 2.6, 3.5, 4.6, 5.5, 6.6, 7.5, 8.6, 9.5]);
  });

  test("フレーム間に複数タップがあっても最低 1 回（1 フレーム true）発火する", () => {
    const rt = recorded();
    TapSequencerNode.evaluate(ctxAt(100, rt)); // anchor
    // [0, 1.9) に 0.55 と 1.45 の両方が入る大きな dt。
    expect(TapSequencerNode.evaluate(ctxAt(101.9, rt))).toEqual({ trigger: true });
    expect(TapSequencerNode.evaluate(ctxAt(101.95, rt))).toEqual({ trigger: false });
  });

  test("ループ長より長い dt（コマ落ち）でも発火する", () => {
    const rt = recorded();
    TapSequencerNode.evaluate(ctxAt(100, rt));  // anchor
    TapSequencerNode.evaluate(ctxAt(100.7, rt)); // 0.55 発火済み
    expect(TapSequencerNode.evaluate(ctxAt(105.7, rt))).toEqual({ trigger: true });
  });

  test("idle（記録なし）では発火しない", () => {
    const rt = new TapSequencerRuntime();
    for (let t = 0; t < 2; t += 0.1) {
      expect(TapSequencerNode.evaluate(ctxAt(t, rt))).toEqual({ trigger: false });
    }
  });

  test("clear 後は発火が止まる", () => {
    const rt = recorded();
    TapSequencerNode.evaluate(ctxAt(100, rt)); // anchor
    rt.clear();
    for (let t = 100.1; t < 103; t += 0.1) {
      expect(TapSequencerNode.evaluate(ctxAt(t, rt))).toEqual({ trigger: false });
    }
  });
});
