import { expect, test, describe } from "bun:test";
import { TapSequencerNode, TapSequencerRuntime } from "./TapSequencerNode";
import type { EvalContext } from "../graph/node-type";
import type { NodeInstance } from "../graph/graph-doc";

/** evaluate 用の最小 EvalContext。inputs/params はテストごとに差し替え可能にする（AutomationNode.test.ts と同型）。 */
function ctxAt(
  timeSec: number,
  state: TapSequencerRuntime | undefined,
  inputs: Record<string, unknown> = {},
  params: Record<string, unknown> = {},
  node?: NodeInstance,
): EvalContext {
  return {
    timeSec,
    input: (id: string) => inputs[id],
    param: (id: string) => (id in params ? params[id] : TapSequencerNode.params.find((p) => p.id === id)?.default),
    node: node ?? { id: "n1", type: "TapSequencer", params: { ...params } },
    state,
  };
}

describe("#204/#278 TapSequencerNode 定義", () => {
  test("control カテゴリ・tapSequencer フラグ・reset 入力・trigger 出力・loopMode(once/loop)/speed param", () => {
    expect(TapSequencerNode.type).toBe("TapSequencer");
    expect(TapSequencerNode.category).toBe("control");
    expect(TapSequencerNode.tapSequencer).toBe(true);
    expect(TapSequencerNode.inputs.map((p) => p.id)).toEqual(["reset"]);
    expect(TapSequencerNode.inputs.find((p) => p.id === "reset")!.type).toBe("trigger");
    expect(TapSequencerNode.outputs.map((o) => o.id)).toEqual(["trigger"]);
    expect(TapSequencerNode.outputs[0]!.type).toBe("trigger");
    const loopMode = TapSequencerNode.params.find((p) => p.id === "loopMode")!;
    expect(loopMode.kind).toBe("enum");
    expect(loopMode.options).toEqual(["once", "loop"]); // pingpong は対象外
    expect(loopMode.default).toBe("loop");
    const speed = TapSequencerNode.params.find((p) => p.id === "speed")!;
    expect(speed.kind).toBe("number");
    expect(speed.default).toBe(1);
    expect(speed.min).toBe(0.1);
    expect(speed.max).toBe(4);
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
    rt.stopRecording(12); // loopLenSec=2, taps=[0.5]
    // playing: 最初の playStep は justStartedPlaying により dt=0 扱い（anchor 相当）。
    rt.playStep(false, 100, "loop", 1); // anchor
    rt.playStep(false, 100.5, "loop", 1);
    expect(rt.status().playPosSec).toBeCloseTo(0.5);
    rt.playStep(false, 102.5, "loop", 1); // 2s ループを 1 周して 0.5
    expect(rt.status().playPosSec).toBeCloseTo(0.5);
  });
});

describe("#278 TapSequencerRuntime: speed", () => {
  test("speed 2 倍で playhead が倍速に進む", () => {
    const rt = new TapSequencerRuntime();
    rt.startRecording(0);
    rt.tap(0.5);
    rt.stopRecording(2); // loopLenSec=2, taps=[0.5]
    rt.playStep(false, 100, "loop", 2); // anchor
    rt.playStep(false, 100.25, "loop", 2); // dt=0.25 * speed2 = 0.5 進む
    expect(rt.status().playPosSec).toBeCloseTo(0.5);
  });

  test("speed 0.5 倍で半分の速さで進む", () => {
    const rt = new TapSequencerRuntime();
    rt.startRecording(0);
    rt.tap(0.5);
    rt.stopRecording(2);
    rt.playStep(false, 100, "loop", 0.5); // anchor
    rt.playStep(false, 101, "loop", 0.5); // dt=1 * speed0.5 = 0.5 進む
    expect(rt.status().playPosSec).toBeCloseTo(0.5);
  });
});

describe("#278 TapSequencerRuntime: loopMode once/loop", () => {
  test("once は末尾で停止し、以後発火せず位置も動かない", () => {
    const rt = new TapSequencerRuntime();
    rt.startRecording(0);
    rt.tap(0.5);
    rt.tap(1.9);
    rt.stopRecording(2); // loopLenSec=2
    rt.playStep(false, 100, "once", 1); // anchor
    rt.playStep(false, 103, "once", 1); // dt=3 > loopLenSec → クランプで末尾停止（playhead=2）
    // status() は表示用に常に "loop" wrap する（AutomationRuntime.status と同じ）ため、
    // playhead がちょうど loopLenSec のときは wrap で 0 と表示される（末尾＝先頭の境界）。
    expect(rt.status().playPosSec).toBeCloseTo(0);
    const firedAfterEnd = rt.playStep(false, 104, "once", 1); // 末尾到達後は dt が実質 0 相当
    expect(firedAfterEnd).toBe(false);
    expect(rt.status().playPosSec).toBeCloseTo(0);
  });

  test("loop は先頭へラップして繰り返す", () => {
    const rt = new TapSequencerRuntime();
    rt.startRecording(0);
    rt.tap(0.5);
    rt.stopRecording(2);
    rt.playStep(false, 100, "loop", 1); // anchor
    rt.playStep(false, 102.5, "loop", 1); // 2.5s 進む → wrap で 0.5s 相当
    expect(rt.status().playPosSec).toBeCloseTo(0.5);
  });
});

describe("#278 TapSequencerRuntime: reset", () => {
  test("reset の立ち上がりで先頭へシークする（playing 中）", () => {
    const rt = new TapSequencerRuntime();
    rt.startRecording(0);
    rt.tap(0.5);
    rt.stopRecording(2);
    rt.playStep(false, 100, "loop", 1); // anchor
    rt.playStep(false, 100.8, "loop", 1);
    expect(rt.status().playPosSec).toBeCloseTo(0.8);
    rt.playStep(true, 100.9, "loop", 1); // reset 立ち上がり
    expect(rt.status().playPosSec).toBeCloseTo(0);
  });

  test("reset は stopped 中でも効く", () => {
    const rt = new TapSequencerRuntime();
    rt.startRecording(0);
    rt.tap(0.5);
    rt.stopRecording(2);
    rt.playStep(false, 100, "loop", 1); // anchor
    rt.playStep(false, 100.8, "loop", 1);
    rt.toggleStopPlay(); // → stopped
    rt.playStep(true, 100.9, "loop", 1); // reset 立ち上がり（停止中でも先頭へ）
    expect(rt.status().playPosSec).toBeCloseTo(0);
    expect(rt.status().phase).toBe("stopped");
  });

  test("recording 中は phase を変えない（無害）", () => {
    const rt = new TapSequencerRuntime();
    rt.startRecording(0);
    rt.playStep(true, 0.1, "loop", 1);
    expect(rt.status().phase).toBe("recording");
  });
});

describe("#278 TapSequencerRuntime: seekToFraction", () => {
  test("playhead/prevPos を両方シーク先に揃え、スキップ区間の誤発火を防ぐ", () => {
    const rt = new TapSequencerRuntime();
    rt.startRecording(0);
    rt.tap(0.5); // タップは 0.5
    rt.stopRecording(2); // loopLenSec=2
    rt.playStep(false, 100, "loop", 1); // anchor
    rt.seekToFraction(0.75); // playhead=1.5（0.5 を飛び越える）
    const fired = rt.playStep(false, 100.01, "loop", 1);
    expect(fired).toBe(false); // prevPos も 1.5 に揃えたのでスキップ区間のタップは鳴らない
    expect(rt.status().playPosSec).toBeCloseTo(1.5, 1);
  });

  test("idle または loopLenSec<=0 は無視する", () => {
    const rt = new TapSequencerRuntime();
    rt.seekToFraction(0.5);
    expect(rt.status().playPosSec).toBe(0);
    expect(rt.status().phase).toBe("idle");
  });

  test("フラクションは 0..1 にクランプする", () => {
    const rt = new TapSequencerRuntime();
    rt.startRecording(0);
    rt.tap(0.5);
    rt.stopRecording(2);
    rt.seekToFraction(-1);
    expect(rt.status().playPosSec).toBeCloseTo(0);
    rt.seekToFraction(1.5);
    const overOne = rt.status().playPosSec;
    rt.seekToFraction(1.0);
    expect(rt.status().playPosSec).toBeCloseTo(overOne);
  });
});

describe("#278 TapSequencerRuntime: 停止/再生トグル", () => {
  test("playing → stopped で位置を凍結し、resume すると同じ位置から連続的に再開する", () => {
    const rt = new TapSequencerRuntime();
    rt.startRecording(0);
    rt.tap(0.5);
    rt.stopRecording(2);
    rt.playStep(false, 100, "loop", 1); // anchor
    rt.playStep(false, 100.3, "loop", 1); // playhead=0.3
    rt.toggleStopPlay(); // → stopped
    expect(rt.status().phase).toBe("stopped");
    rt.playStep(false, 101.3, "loop", 1); // stopped 中はフレームが来ても凍結
    expect(rt.status().playPosSec).toBeCloseTo(0.3);
    rt.toggleStopPlay(); // → playing（同じ位置から）
    rt.playStep(false, 101.4, "loop", 1); // dt=0.1（停止していた 1s は加算されない）
    expect(rt.status().playPosSec).toBeCloseTo(0.4);
  });

  test("idle・recording 中は無効（no-op）", () => {
    const rt = new TapSequencerRuntime();
    rt.toggleStopPlay();
    expect(rt.status().phase).toBe("idle");
    rt.startRecording(0);
    rt.toggleStopPlay();
    expect(rt.status().phase).toBe("recording");
  });

  test("stopped 中は発火しない", () => {
    const rt = new TapSequencerRuntime();
    rt.startRecording(0);
    rt.tap(0.5);
    rt.stopRecording(2);
    rt.playStep(false, 100, "loop", 1); // anchor
    rt.toggleStopPlay(); // → stopped（playhead=0）
    const fired = rt.playStep(false, 100.6, "loop", 1); // 0.5 を跨ぐタイミングでも停止中は発火しない
    expect(fired).toBe(false);
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

describe("#278 evaluate: reset ポート / loopMode・speed param", () => {
  test("reset 入力の立ち上がりで先頭へシークする（evaluate 経由）", () => {
    const rt = new TapSequencerRuntime();
    rt.startRecording(0);
    rt.tap(0.5);
    rt.stopRecording(2); // loopLenSec=2
    TapSequencerNode.evaluate(ctxAt(100, rt, { reset: false })); // anchor
    TapSequencerNode.evaluate(ctxAt(100.8, rt, { reset: false })); // playhead=0.8
    TapSequencerNode.evaluate(ctxAt(100.9, rt, { reset: true })); // reset 立ち上がり
    // reset 後、0.5 のタップまでの距離が再び 0.5s ぶん必要になる（先頭へ戻ったことの確認）。
    const beforeTap = TapSequencerNode.evaluate(ctxAt(101.3, rt, { reset: false })); // 0.4s 進行 → 未発火
    expect(beforeTap.trigger).toBe(false);
    const atTap = TapSequencerNode.evaluate(ctxAt(101.42, rt, { reset: false })); // 0.5 を跨ぐ
    expect(atTap.trigger).toBe(true);
  });

  test("不正な loopMode（pingpong 等）は loop へフォールバックする", () => {
    const rt = new TapSequencerRuntime();
    rt.startRecording(0);
    rt.tap(0.5);
    rt.stopRecording(2); // loopLenSec=2
    const node: NodeInstance = { id: "n1", type: "TapSequencer", params: { loopMode: "pingpong" } };
    TapSequencerNode.evaluate(ctxAt(0, rt, {}, { loopMode: "pingpong" }, node)); // anchor
    // loop へフォールバックしていればループ 2s で先頭に戻ってくる（once ならクランプされ末尾で停止する）。
    TapSequencerNode.evaluate(ctxAt(2.5, rt, {}, { loopMode: "pingpong" }, node)); // 2.5s 進む → wrap で 0.5s
    const st = rt.status();
    expect(st.playPosSec).toBeCloseTo(0.5); // once なら末尾クランプで 2 のはず
  });

  test("speed param で倍速再生する（evaluate 経由）", () => {
    const rt = new TapSequencerRuntime();
    rt.startRecording(0);
    rt.tap(0.5);
    rt.stopRecording(2);
    const node: NodeInstance = { id: "n1", type: "TapSequencer", params: { speed: 2 } };
    TapSequencerNode.evaluate(ctxAt(0, rt, {}, { speed: 2 }, node)); // anchor
    TapSequencerNode.evaluate(ctxAt(0.25, rt, {}, { speed: 2 }, node)); // dt=0.25 * 2 = 0.5
    expect(rt.status().playPosSec).toBeCloseTo(0.5);
  });

  test("loopMode=once は末尾で停止する（evaluate 経由）", () => {
    const rt = new TapSequencerRuntime();
    rt.startRecording(0);
    rt.tap(0.5);
    rt.stopRecording(2);
    const node: NodeInstance = { id: "n1", type: "TapSequencer", params: { loopMode: "once" } };
    TapSequencerNode.evaluate(ctxAt(0, rt, {}, { loopMode: "once" }, node)); // anchor
    TapSequencerNode.evaluate(ctxAt(10, rt, {}, { loopMode: "once" }, node)); // 大きく進む → 末尾クランプ（playhead=2）
    // status() は常に "loop" wrap するため、ちょうど末尾（=loopLenSec）は 0 と表示される。
    expect(rt.status().playPosSec).toBeCloseTo(0);
  });
});
