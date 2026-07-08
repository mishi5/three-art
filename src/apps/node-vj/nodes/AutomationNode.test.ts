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
  test("control カテゴリ・in/arm/reset 入力・out 出力", () => {
    expect(AutomationNode.type).toBe("Automation");
    expect(AutomationNode.category).toBe("control");
    expect(AutomationNode.inputs.map((p) => p.id)).toEqual(["in", "arm", "reset"]);
    expect(AutomationNode.inputs.find((p) => p.id === "in")!.type).toBe("number");
    expect(AutomationNode.inputs.find((p) => p.id === "arm")!.type).toBe("trigger");
    expect(AutomationNode.inputs.find((p) => p.id === "reset")!.type).toBe("trigger");
    expect(AutomationNode.outputs.map((p) => p.id)).toEqual(["out"]);
  });

  test("params: loopMode(既定loop)/speed(既定1)/recordedFrames・recordedLoopLenSec(hidden)", () => {
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

describe("#186 AutomationRuntime 状態遷移（純粋 step）", () => {
  test("初期は idle・in をパススルー", () => {
    const rt = new AutomationRuntime();
    const out = rt.step({ inVal: 3, arm: false, reset: false, timeSec: 0, loopMode: "loop", speed: 1 }, () => {});
    expect(out).toBe(3);
    expect(rt.status().phase).toBe("idle");
  });

  test("arm 立ち上がりで recording へ。記録中は in をパススルーし frames が積まれる", () => {
    const rt = new AutomationRuntime();
    rt.step({ inVal: 0, arm: true, reset: false, timeSec: 0, loopMode: "loop", speed: 1 }, () => {}); // 開始
    expect(rt.status().phase).toBe("recording");
    const out = rt.step({ inVal: 5, arm: true, reset: false, timeSec: 0.1, loopMode: "loop", speed: 1 }, () => {});
    expect(out).toBe(5); // パススルー
    expect(rt.status().frameCount).toBe(2); // 開始フレーム(t=0)＋このフレーム
  });

  test("もう一度 arm（立ち上がり）で録音確定 → playing。onCommit が frames/loopLenSec とともに呼ばれる", () => {
    const rt = new AutomationRuntime();
    rt.step({ inVal: 1, arm: true, reset: false, timeSec: 0, loopMode: "loop", speed: 1 }, () => {});
    rt.step({ inVal: 2, arm: false, reset: false, timeSec: 0.5, loopMode: "loop", speed: 1 }, () => {}); // arm 継続 false
    let committed: { frames: unknown; loopLenSec: number } | null = null;
    rt.step({ inVal: 3, arm: true, reset: false, timeSec: 1.0, loopMode: "loop", speed: 1 },
      (frames, loopLenSec) => { committed = { frames, loopLenSec }; });
    expect(rt.status().phase).toBe("playing");
    expect(rt.status().loopLenSec).toBeCloseTo(1.0);
    expect(committed).not.toBeNull();
    expect((committed as unknown as { loopLenSec: number }).loopLenSec).toBeCloseTo(1.0);
  });

  test("開始直後に即確定（1 フレームだけ記録）でも frames が非空なら再生になる", () => {
    // arm は「押す→離す→もう一度押す」の 2 つの立ち上がりが要る（1 フレーム目で開始、
    // 2 フレーム目は arm を落として継続録音、3 フレーム目の立ち上がりで確定）。
    const rt = new AutomationRuntime();
    rt.step({ inVal: 7, arm: true, reset: false, timeSec: 0, loopMode: "loop", speed: 1 }, () => {}); // 開始
    rt.step({ inVal: 7, arm: false, reset: false, timeSec: 0.05, loopMode: "loop", speed: 1 }, () => {}); // 継続
    let committed = false;
    rt.step({ inVal: 7, arm: true, reset: false, timeSec: 0.1, loopMode: "loop", speed: 1 }, () => { committed = true; }); // 確定
    expect(committed).toBe(true);
    expect(rt.status().frameCount).toBe(2);
  });

  test("再 arm（playing 中）で前の記録を破棄して新規録音を開始する", () => {
    const rt = new AutomationRuntime();
    rt.step({ inVal: 1, arm: true, reset: false, timeSec: 0, loopMode: "loop", speed: 1 }, () => {});
    rt.step({ inVal: 2, arm: false, reset: false, timeSec: 0.5, loopMode: "loop", speed: 1 }, () => {});
    rt.step({ inVal: 3, arm: true, reset: false, timeSec: 1.0, loopMode: "loop", speed: 1 }, () => {}); // 確定→playing
    expect(rt.status().phase).toBe("playing");
    rt.step({ inVal: 3, arm: false, reset: false, timeSec: 1.5, loopMode: "loop", speed: 1 }, () => {}); // arm を落とす
    rt.step({ inVal: 9, arm: true, reset: false, timeSec: 2.0, loopMode: "loop", speed: 1 }, () => {}); // 再 arm（立ち上がり）
    const st = rt.status();
    expect(st.phase).toBe("recording");
    expect(st.frameCount).toBe(1); // 破棄され、この呼び出しの 1 点のみ
  });

  test("reset の立ち上がりで再生位置を先頭へ戻す", () => {
    const rt = new AutomationRuntime();
    rt.step({ inVal: 0, arm: true, reset: false, timeSec: 0, loopMode: "loop", speed: 1 }, () => {});
    rt.step({ inVal: 10, arm: false, reset: false, timeSec: 0.5, loopMode: "loop", speed: 1 }, () => {});
    rt.step({ inVal: 0, arm: true, reset: false, timeSec: 1.0, loopMode: "loop", speed: 1 }, () => {}); // 確定→playing loopLen=1
    rt.step({ inVal: 0, arm: false, reset: false, timeSec: 1.5, loopMode: "loop", speed: 1 }, () => {}); // 再生 0.5s 進む
    expect(rt.status().playPosSec).toBeCloseTo(0.5);
    rt.step({ inVal: 0, arm: false, reset: true, timeSec: 1.6, loopMode: "loop", speed: 1 }, () => {}); // reset 立ち上がり
    expect(rt.status().playPosSec).toBeCloseTo(0);
  });

  test("playing 中の出力は記録値を線形補間する", () => {
    const rt = new AutomationRuntime();
    rt.step({ inVal: 0, arm: true, reset: false, timeSec: 0, loopMode: "loop", speed: 1 }, () => {});
    rt.step({ inVal: 10, arm: false, reset: false, timeSec: 1.0, loopMode: "loop", speed: 1 }, () => {});
    rt.step({ inVal: 0, arm: true, reset: false, timeSec: 2.0, loopMode: "loop", speed: 1 }, () => {}); // 確定 loopLen=2
    const out = rt.step({ inVal: 0, arm: false, reset: false, timeSec: 2.5, loopMode: "loop", speed: 1 }, () => {});
    // playhead は確定直後 0 から 0.5s 進む。frames=[(0,0),(1,10)] なので t=0.5 は補間で 5。
    expect(out).toBeCloseTo(5);
  });
});

describe("#186 evaluate（AutomationNode 経由）", () => {
  test("録音→再生の一連の流れが params.recordedFrames へ書き戻される", () => {
    const node: NodeInstance = { id: "n1", type: "Automation", params: {} };
    const rt = new AutomationRuntime();
    AutomationNode.evaluate(ctxAt(0, rt, { in: 0, arm: true, reset: false }, {}, node));
    AutomationNode.evaluate(ctxAt(1, rt, { in: 10, arm: false, reset: false }, {}, node));
    AutomationNode.evaluate(ctxAt(2, rt, { in: 0, arm: true, reset: false }, {}, node)); // 確定
    expect(Array.isArray(node.params.recordedFrames)).toBe(true);
    expect((node.params.recordedFrames as unknown[]).length).toBeGreaterThan(0);
    expect(node.params.recordedLoopLenSec).toBeCloseTo(2.0);
  });

  test("既存の recordedFrames/recordedLoopLenSec（永続化復元）から playing で起動する", () => {
    const rt = new AutomationRuntime();
    const node: NodeInstance = {
      id: "n1", type: "Automation",
      params: { recordedFrames: [{ t: 0, v: 0 }, { t: 1, v: 20 }], recordedLoopLenSec: 1 },
    };
    const out = AutomationNode.evaluate(
      ctxAt(0, rt, { in: 0, arm: false, reset: false }, { recordedFrames: node.params.recordedFrames, recordedLoopLenSec: 1 }, node),
    );
    expect(out.out).toBeCloseTo(0); // 復元直後 playhead=0 → t=0 の値
  });

  test("壊れた recordedFrames（不正な形）は無視して idle から始まる", () => {
    const rt = new AutomationRuntime();
    const node: NodeInstance = { id: "n1", type: "Automation", params: { recordedFrames: "broken", recordedLoopLenSec: 1 } };
    const out = AutomationNode.evaluate(
      ctxAt(0, rt, { in: 42, arm: false, reset: false }, { recordedFrames: "broken", recordedLoopLenSec: 1 }, node),
    );
    expect(out.out).toBe(42); // idle: in をパススルー
  });

  test("loopMode=once は末尾で停止する", () => {
    const rt = new AutomationRuntime();
    const node: NodeInstance = { id: "n1", type: "Automation", params: { loopMode: "once" } };
    AutomationNode.evaluate(ctxAt(0, rt, { in: 0, arm: true, reset: false }, { loopMode: "once" }, node));
    AutomationNode.evaluate(ctxAt(1, rt, { in: 10, arm: false, reset: false }, { loopMode: "once" }, node));
    AutomationNode.evaluate(ctxAt(2, rt, { in: 0, arm: true, reset: false }, { loopMode: "once" }, node)); // 確定 loopLen=2
    const mid = AutomationNode.evaluate(ctxAt(3, rt, { in: 0, arm: false, reset: false }, { loopMode: "once" }, node));
    expect(mid.out).toBeCloseTo(10); // 1s 経過 → t=1 の値
    const past = AutomationNode.evaluate(ctxAt(10, rt, { in: 0, arm: false, reset: false }, { loopMode: "once" }, node));
    expect(past.out).toBeCloseTo(10); // 末尾で停止し続ける
  });
});
