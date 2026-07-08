import { expect, test, describe } from "bun:test";
import { AutomationNode, AutomationRuntime } from "./AutomationNode";
import type { EvalContext } from "../graph/node-type";
import type { NodeInstance } from "../graph/graph-doc";

/** evaluate 用の最小 EvalContext。inputs/params はテストごとに差し替え可能にする。 */
function ctxAt(
  timeSec: number,
  state: AutomationRuntime | undefined,
  inputs: Record<string, unknown> = {},
  params: Record<string, unknown> = {},
  node?: NodeInstance,
): EvalContext {
  return {
    timeSec,
    input: (id: string) => inputs[id],
    param: (id: string) => (id in params ? params[id] : AutomationNode.params.find((p) => p.id === id)?.default),
    node: node ?? { id: "n1", type: "Automation", params: { ...params } },
    state,
  };
}

describe("#186 AutomationNode 定義", () => {
  test("control カテゴリ・automation フラグ・reset 入力のみ・out 出力", () => {
    expect(AutomationNode.type).toBe("Automation");
    expect(AutomationNode.category).toBe("control");
    expect(AutomationNode.automation).toBe(true);
    expect(AutomationNode.inputs.map((p) => p.id)).toEqual(["reset"]);
    expect(AutomationNode.inputs.find((p) => p.id === "reset")!.type).toBe("trigger");
    expect(AutomationNode.outputs.map((p) => p.id)).toEqual(["out"]);
  });

  test("params: value（通常 number・接続可＋手動）/loopMode(既定loop)/speed(既定1)/recordedFrames・recordedLoopLenSec(hidden)", () => {
    const value = AutomationNode.params.find((p) => p.id === "value")!;
    expect(value.kind).toBe("number");
    expect(value.default).toBe(0);
    expect(value.noInput).toBeUndefined(); // noInput なし＝自動入力ポート化される（#74）
    expect(value.hidden).toBeUndefined();
    const loopMode = AutomationNode.params.find((p) => p.id === "loopMode")!;
    expect(loopMode.kind).toBe("enum");
    expect(loopMode.options).toEqual(["once", "loop", "pingpong"]);
    expect(loopMode.default).toBe("loop");
    const speed = AutomationNode.params.find((p) => p.id === "speed")!;
    expect(speed.default).toBe(1);
    const frames = AutomationNode.params.find((p) => p.id === "recordedFrames")!;
    expect(frames.hidden).toBe(true);
    expect(frames.default).toEqual([]);
    const loopLen = AutomationNode.params.find((p) => p.id === "recordedLoopLenSec")!;
    expect(loopLen.hidden).toBe(true);
    expect(loopLen.default).toBe(0);
  });

  test("createState は AutomationRuntime を返す", () => {
    const s = AutomationNode.createState!(undefined as never);
    expect(s).toBeInstanceOf(AutomationRuntime);
  });

  test("state 未生成は out=0", () => {
    expect(AutomationNode.evaluate(ctxAt(0, undefined))).toEqual({ out: 0 });
  });
});

describe("#186 AutomationRuntime 状態遷移（純粋 step・startRecording/stopRecording）", () => {
  test("初期は idle・value をパススルー", () => {
    const rt = new AutomationRuntime();
    const out = rt.step(3, false, 0, "loop", 1, () => {});
    expect(out).toBe(3);
    expect(rt.status().phase).toBe("idle");
  });

  test("startRecording で recording へ。記録中は value をパススルーし frames が積まれる", () => {
    const rt = new AutomationRuntime();
    rt.startRecording();
    rt.step(0, false, 0, "loop", 1, () => {}); // 開始フレーム
    expect(rt.status().phase).toBe("recording");
    const out = rt.step(5, false, 0.1, "loop", 1, () => {});
    expect(out).toBe(5); // パススルー
    expect(rt.status().frameCount).toBe(2); // 開始フレーム(t=0)＋このフレーム
  });

  test("stopRecording で録音確定 → playing。onCommit が frames/loopLenSec とともに呼ばれる", () => {
    const rt = new AutomationRuntime();
    rt.startRecording();
    rt.step(1, false, 0, "loop", 1, () => {});
    rt.step(2, false, 0.5, "loop", 1, () => {});
    rt.stopRecording();
    let committed: { frames: unknown; loopLenSec: number } | null = null;
    rt.step(3, false, 1.0, "loop", 1, (frames, loopLenSec) => { committed = { frames, loopLenSec }; });
    expect(rt.status().phase).toBe("playing");
    expect(rt.status().loopLenSec).toBeCloseTo(1.0);
    expect(committed).not.toBeNull();
    expect((committed as unknown as { loopLenSec: number }).loopLenSec).toBeCloseTo(1.0);
  });

  test("開始直後に即停止（1 フレームだけ記録）でも frames が非空なら再生になる", () => {
    const rt = new AutomationRuntime();
    rt.startRecording();
    rt.step(7, false, 0, "loop", 1, () => {}); // 開始フレーム
    rt.stopRecording();
    let committed = false;
    rt.step(7, false, 0.1, "loop", 1, () => { committed = true; }); // 確定
    expect(committed).toBe(true);
    expect(rt.status().frameCount).toBe(1);
  });

  test("経過秒 0 以下（同一時刻で開始→終了）は再生せず idle のまま", () => {
    const rt = new AutomationRuntime();
    rt.startRecording();
    rt.step(1, false, 0, "loop", 1, () => {}); // 開始（recordStartSec=0）
    rt.stopRecording();
    let committed = false;
    rt.step(1, false, 0, "loop", 1, () => { committed = true; }); // 同時刻で終了 → len=0
    expect(committed).toBe(false);
    expect(rt.status().phase).toBe("idle");
  });

  test("再 startRecording（playing 中）で前の記録を破棄して新規録音を開始する（オーバー録音の破棄）", () => {
    const rt = new AutomationRuntime();
    rt.startRecording();
    rt.step(1, false, 0, "loop", 1, () => {});
    rt.step(2, false, 0.5, "loop", 1, () => {});
    rt.stopRecording();
    rt.step(3, false, 1.0, "loop", 1, () => {}); // 確定→playing
    expect(rt.status().phase).toBe("playing");
    rt.step(3, false, 1.5, "loop", 1, () => {}); // 再生中
    rt.startRecording(); // 再び記録開始（前の記録を破棄）
    const st1 = rt.step(9, false, 2.0, "loop", 1, () => {});
    const st = rt.status();
    expect(st.phase).toBe("recording");
    expect(st.frameCount).toBe(1); // 破棄され、この呼び出しの 1 点のみ
    expect(st1).toBe(9);
  });

  test("reset の立ち上がりで再生位置を先頭へ戻す", () => {
    const rt = new AutomationRuntime();
    rt.startRecording();
    rt.step(0, false, 0, "loop", 1, () => {});
    rt.step(10, false, 0.5, "loop", 1, () => {});
    rt.stopRecording();
    rt.step(0, false, 1.0, "loop", 1, () => {}); // 確定→playing loopLen=1
    rt.step(0, false, 1.5, "loop", 1, () => {}); // 再生 0.5s 進む
    expect(rt.status().playPosSec).toBeCloseTo(0.5);
    rt.step(0, true, 1.6, "loop", 1, () => {}); // reset 立ち上がり
    expect(rt.status().playPosSec).toBeCloseTo(0);
  });

  test("reset は録音中でも無害に効く（phase 不問）", () => {
    const rt = new AutomationRuntime();
    rt.startRecording();
    rt.step(1, false, 0, "loop", 1, () => {});
    rt.step(1, true, 0.1, "loop", 1, () => {}); // 録音中に reset
    expect(rt.status().phase).toBe("recording"); // 録音は継続
  });

  test("playing 中の出力は記録値を線形補間する", () => {
    const rt = new AutomationRuntime();
    rt.startRecording();
    rt.step(0, false, 0, "loop", 1, () => {});
    rt.step(10, false, 1.0, "loop", 1, () => {});
    rt.stopRecording();
    rt.step(0, false, 2.0, "loop", 1, () => {}); // 確定 loopLen=2
    const out = rt.step(0, false, 2.5, "loop", 1, () => {});
    // playhead は確定直後 0 から 0.5s 進む。frames=[(0,0),(1,10)] なので t=0.5 は補間で 5。
    expect(out).toBeCloseTo(5);
  });

  test("loopMode=once は末尾で停止する", () => {
    const rt = new AutomationRuntime();
    rt.startRecording();
    rt.step(0, false, 0, "once", 1, () => {});
    rt.step(10, false, 1, "once", 1, () => {});
    rt.stopRecording();
    rt.step(0, false, 2, "once", 1, () => {}); // 確定 loopLen=2
    const mid = rt.step(0, false, 3, "once", 1, () => {});
    expect(mid).toBeCloseTo(10); // 1s 経過 → t=1 の値
    const past = rt.step(0, false, 10, "once", 1, () => {});
    expect(past).toBeCloseTo(10); // 末尾で停止し続ける
  });

  test("loopMode=loop は先頭へラップする", () => {
    const rt = new AutomationRuntime();
    rt.startRecording();
    rt.step(0, false, 0, "loop", 1, () => {});
    rt.step(10, false, 1, "loop", 1, () => {});
    rt.stopRecording();
    // 確定はこの step 呼び出し（timeSec=2）で処理される＝ループ長は recordStartSec(0) から
    // ここまでの経過秒 2（frames 自体は t=0/t=1 の 2 点のみ）。
    rt.step(0, false, 2, "loop", 1, () => {});
    expect(rt.status().loopLenSec).toBeCloseTo(2);
    const out = rt.step(0, false, 4.5, "loop", 1, () => {}); // 2.5s 進む → wrap で 0.5s 相当
    expect(out).toBeCloseTo(5); // frames=[(0,0),(1,10)] の t=0.5 は補間で 5
  });

  test("loopMode=pingpong は往復する", () => {
    const rt = new AutomationRuntime();
    rt.startRecording();
    rt.step(0, false, 0, "pingpong", 1, () => {});
    rt.step(10, false, 1, "pingpong", 1, () => {});
    rt.stopRecording();
    rt.step(0, false, 2, "pingpong", 1, () => {}); // 確定 loopLen=2
    // playhead は 0 から進む。3s 経過（period=4）で playhead=3 → loopPosition は復路で 1。
    const out = rt.step(0, false, 5, "pingpong", 1, () => {});
    // frames=[(0,0),(1,10)] を loopLenSec=2 のスケールでサンプル。t=1 は末尾クランプで 10。
    expect(out).toBeCloseTo(10);
  });

  test("clear で idle に戻り再生が止まる", () => {
    const rt = new AutomationRuntime();
    rt.startRecording();
    rt.step(0, false, 0, "loop", 1, () => {});
    rt.step(10, false, 1, "loop", 1, () => {});
    rt.stopRecording();
    rt.step(0, false, 2, "loop", 1, () => {}); // 確定→playing
    expect(rt.status().phase).toBe("playing");
    rt.clear();
    const st = rt.status();
    expect(st.phase).toBe("idle");
    expect(st.frameCount).toBe(0);
    expect(st.loopLenSec).toBe(0);
  });

  test("seekToFraction: loopLenSec>0 の playing 中は fraction*loopLenSec へ再生位置を移動する", () => {
    const rt = new AutomationRuntime();
    rt.startRecording();
    rt.step(0, false, 0, "loop", 1, () => {});
    rt.step(10, false, 2, "loop", 1, () => {});
    rt.stopRecording();
    rt.step(0, false, 4, "loop", 1, () => {}); // 確定 loopLenSec=4
    rt.seekToFraction(0.5); // playhead = 2
    expect(rt.status().playPosSec).toBeCloseTo(2);
  });

  test("seekToFraction: フラクションは 0..1 にクランプする（超過/下回る分は捨てる）", () => {
    const rt = new AutomationRuntime();
    rt.startRecording();
    rt.step(0, false, 0, "loop", 1, () => {});
    rt.step(10, false, 2, "loop", 1, () => {});
    rt.stopRecording();
    rt.step(0, false, 4, "loop", 1, () => {}); // 確定 loopLenSec=4
    rt.seekToFraction(-1); // 下限クランプ
    expect(rt.status().playPosSec).toBeCloseTo(0);
    rt.seekToFraction(1.0);
    const atOne = rt.status().playPosSec;
    rt.seekToFraction(1.5); // 上限クランプ＝ 1.0 と同じ位置になるはず（クランプしなければ異なる位置になる）
    expect(rt.status().playPosSec).toBeCloseTo(atOne);
  });

  test("seekToFraction: idle（未記録）は無視する", () => {
    const rt = new AutomationRuntime();
    rt.seekToFraction(0.5);
    expect(rt.status().playPosSec).toBe(0);
    expect(rt.status().phase).toBe("idle");
  });
});

describe("#186 evaluate（AutomationNode 経由）", () => {
  test("録音→再生の一連の流れが params.recordedFrames へ書き戻される", () => {
    const node: NodeInstance = { id: "n1", type: "Automation", params: {} };
    const rt = new AutomationRuntime();
    rt.startRecording();
    AutomationNode.evaluate(ctxAt(0, rt, { reset: false }, { value: 0 }, node));
    AutomationNode.evaluate(ctxAt(1, rt, { reset: false }, { value: 10 }, node));
    rt.stopRecording();
    AutomationNode.evaluate(ctxAt(2, rt, { reset: false }, { value: 0 }, node)); // 確定
    expect(Array.isArray(node.params.recordedFrames)).toBe(true);
    expect((node.params.recordedFrames as unknown[]).length).toBeGreaterThan(0);
    expect(node.params.recordedLoopLenSec).toBeCloseTo(2.0);
  });

  test("value param は接続時に上流値が使われる（ctx.param が解決済みの前提）", () => {
    const node: NodeInstance = { id: "n1", type: "Automation", params: {} };
    const rt = new AutomationRuntime();
    // ctxAt の param() は params に無ければ default(=0) を返すが、接続時の値は
    // evaluator.ts 側で inputValues として解決済みのものが渡る想定。ここでは
    // 直接 value を指定して手動/接続いずれでも同じ経路（ctx.param("value")）を通ることを確認する。
    const out = AutomationNode.evaluate(ctxAt(0, rt, { reset: false }, { value: 42 }, node));
    expect(out.out).toBe(42); // idle: パススルー
  });

  test("既存の recordedFrames/recordedLoopLenSec（永続化復元）から playing で起動する", () => {
    const rt = new AutomationRuntime();
    const node: NodeInstance = {
      id: "n1", type: "Automation",
      params: { recordedFrames: [{ t: 0, v: 0 }, { t: 1, v: 20 }], recordedLoopLenSec: 1 },
    };
    const out = AutomationNode.evaluate(
      ctxAt(0, rt, { reset: false }, { recordedFrames: node.params.recordedFrames, recordedLoopLenSec: 1 }, node),
    );
    expect(out.out).toBeCloseTo(0); // 復元直後 playhead=0 → t=0 の値
  });

  test("壊れた recordedFrames（不正な形）は無視して idle から始まる", () => {
    const rt = new AutomationRuntime();
    const node: NodeInstance = { id: "n1", type: "Automation", params: { recordedFrames: "broken", recordedLoopLenSec: 1 } };
    const out = AutomationNode.evaluate(
      ctxAt(0, rt, { reset: false }, { value: 42, recordedFrames: "broken", recordedLoopLenSec: 1 }, node),
    );
    expect(out.out).toBe(42); // idle: value をパススルー
  });

  test("loopMode=once は末尾で停止する（evaluate 経由）", () => {
    const rt = new AutomationRuntime();
    const node: NodeInstance = { id: "n1", type: "Automation", params: { loopMode: "once" } };
    rt.startRecording();
    AutomationNode.evaluate(ctxAt(0, rt, { reset: false }, { value: 0, loopMode: "once" }, node));
    AutomationNode.evaluate(ctxAt(1, rt, { reset: false }, { value: 10, loopMode: "once" }, node));
    rt.stopRecording();
    AutomationNode.evaluate(ctxAt(2, rt, { reset: false }, { value: 0, loopMode: "once" }, node)); // 確定 loopLen=2
    const mid = AutomationNode.evaluate(ctxAt(3, rt, { reset: false }, { value: 0, loopMode: "once" }, node));
    expect(mid.out).toBeCloseTo(10); // 1s 経過 → t=1 の値
    const past = AutomationNode.evaluate(ctxAt(10, rt, { reset: false }, { value: 0, loopMode: "once" }, node));
    expect(past.out).toBeCloseTo(10); // 末尾で停止し続ける
  });
});
