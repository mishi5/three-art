// #272: MidiCC ノード（CC → number）のテスト。ControlBus へ直接イベントを注入して検証し、
// 実機 MIDI デバイスには一切触らない。
import { describe, expect, test } from "bun:test";
import { MidiCCNode, MidiCCRuntime } from "./MidiCCNode";
import { ControlBus } from "../midi/control-bus";
import type { EvalContext } from "../graph/node-type";
import type { NodeInstance } from "../graph/graph-doc";

/** evaluate 用の最小 EvalContext（BeatClockNode.test.ts と同型）。 */
function ctxFor(state: MidiCCRuntime | undefined, node?: NodeInstance): EvalContext {
  const n = node ?? { id: "n1", type: "MidiCC", params: {} };
  return {
    timeSec: 0,
    input: () => undefined,
    param: (id: string) =>
      id in n.params ? n.params[id] : MidiCCNode.params.find((p) => p.id === id)?.default,
    node: n,
    state,
  };
}

const cc = (channel: number, number: number, value: number) =>
  ({ kind: "cc", channel, number, value }) as const;

describe("#272 MidiCCNode 定義", () => {
  test("source カテゴリ・midiLearn フラグ・value の number 出力", () => {
    expect(MidiCCNode.type).toBe("MidiCC");
    expect(MidiCCNode.category).toBe("source");
    expect(MidiCCNode.midiLearn).toBe(true);
    expect(MidiCCNode.outputs.map((o) => o.id)).toEqual(["value"]);
    expect(MidiCCNode.outputs[0]!.type).toBe("number");
  });

  test("channel / cc は noInput（配線対象ではなく割当設定）", () => {
    for (const id of ["channel", "cc"]) {
      expect(MidiCCNode.params.find((p) => p.id === id)!.noInput).toBe(true);
    }
    // レンジは配線して動かせる。
    for (const id of ["min", "max"]) {
      expect(MidiCCNode.params.find((p) => p.id === id)!.noInput).toBeUndefined();
    }
  });

  test("channel の既定は 0（omni）・cc の既定は 1", () => {
    expect(MidiCCNode.params.find((p) => p.id === "channel")!.default).toBe(0);
    expect(MidiCCNode.params.find((p) => p.id === "cc")!.default).toBe(1);
  });
});

describe("#272 MidiCC: 値の読み出し", () => {
  test("state 無しでも落ちず min を返す", () => {
    expect(MidiCCNode.evaluate(ctxFor(undefined))).toEqual({ value: 0 });
  });

  test("未受信のときは min を返す", () => {
    const rt = new MidiCCRuntime(new ControlBus());
    const node: NodeInstance = { id: "n1", type: "MidiCC", params: { channel: 1, cc: 74, min: 2, max: 5 } };
    expect(MidiCCNode.evaluate(ctxFor(rt, node))).toEqual({ value: 2 });
  });

  test("受信値 0..1 を min..max へ写像する", () => {
    const bus = new ControlBus();
    const rt = new MidiCCRuntime(bus);
    const node: NodeInstance = { id: "n1", type: "MidiCC", params: { channel: 1, cc: 74, min: 0, max: 100 } };
    bus.emit(cc(1, 74, 1));
    expect(MidiCCNode.evaluate(ctxFor(rt, node))).toEqual({ value: 100 });
    bus.emit(cc(1, 74, 0.5));
    expect(MidiCCNode.evaluate(ctxFor(rt, node))).toEqual({ value: 50 });
  });

  test("channel 0（omni）はどの ch の CC でも拾う", () => {
    const bus = new ControlBus();
    const rt = new MidiCCRuntime(bus);
    const node: NodeInstance = { id: "n1", type: "MidiCC", params: { channel: 0, cc: 74 } };
    bus.emit(cc(9, 74, 1));
    expect(MidiCCNode.evaluate(ctxFor(rt, node))).toEqual({ value: 1 });
  });

  test("割当外の CC は無視する", () => {
    const bus = new ControlBus();
    const rt = new MidiCCRuntime(bus);
    const node: NodeInstance = { id: "n1", type: "MidiCC", params: { channel: 1, cc: 74, min: 0, max: 1 } };
    bus.emit(cc(1, 75, 1));
    expect(MidiCCNode.evaluate(ctxFor(rt, node))).toEqual({ value: 0 });
  });

  test("値は保持され、次のフレームも同じ値を出し続ける", () => {
    const bus = new ControlBus();
    const rt = new MidiCCRuntime(bus);
    const node: NodeInstance = { id: "n1", type: "MidiCC", params: { channel: 1, cc: 74 } };
    bus.emit(cc(1, 74, 0.25));
    expect(MidiCCNode.evaluate(ctxFor(rt, node))).toEqual({ value: 0.25 });
    expect(MidiCCNode.evaluate(ctxFor(rt, node))).toEqual({ value: 0.25 });
  });
});

describe("#272 MidiCC: Learn", () => {
  test("LEARN 後に届いた CC の ch/番号を params へ書き戻す", () => {
    const bus = new ControlBus();
    const rt = new MidiCCRuntime(bus);
    const node: NodeInstance = { id: "n1", type: "MidiCC", params: { channel: 0, cc: 1 } };
    rt.learn.start(bus);
    MidiCCNode.evaluate(ctxFor(rt, node)); // まだ何も来ていない
    expect(node.params.cc).toBe(1);
    bus.emit(cc(3, 74, 0.5));
    MidiCCNode.evaluate(ctxFor(rt, node));
    expect(node.params.channel).toBe(3);
    expect(node.params.cc).toBe(74);
    expect(rt.learn.waiting).toBe(false);
  });

  test("learn したフレームからその CC の値を出す（1 フレーム遅れない）", () => {
    const bus = new ControlBus();
    const rt = new MidiCCRuntime(bus);
    const node: NodeInstance = { id: "n1", type: "MidiCC", params: { channel: 0, cc: 1, min: 0, max: 1 } };
    rt.learn.start(bus);
    bus.emit(cc(3, 74, 1));
    expect(MidiCCNode.evaluate(ctxFor(rt, node))).toEqual({ value: 1 });
  });
});
