// #272: MidiPad ノード（4×4 の実機パッド → index / trigger / velocity）のテスト。
import { describe, expect, test } from "bun:test";
import { MidiPadNode, MidiPadRuntime } from "./MidiPadNode";
import { MIDI_PAD_COUNT } from "./midi-node-logic";
import { ControlBus } from "../midi/control-bus";
import type { EvalContext } from "../graph/node-type";
import type { NodeInstance } from "../graph/graph-doc";

function ctxFor(state: MidiPadRuntime | undefined, node?: NodeInstance): EvalContext {
  const n = node ?? { id: "n1", type: "MidiPad", params: {} };
  return {
    timeSec: 0,
    input: () => undefined,
    param: (id: string) =>
      id in n.params ? n.params[id] : MidiPadNode.params.find((p) => p.id === id)?.default,
    node: n,
    state,
  };
}

const noteOn = (channel: number, number: number, velocity = 1) =>
  ({ kind: "note", channel, number, on: true, velocity }) as const;
const noteOff = (channel: number, number: number) =>
  ({ kind: "note", channel, number, on: false, velocity: 0 }) as const;

/** ch1 / baseNote 36 に割り当てたノード。 */
const assigned = (): NodeInstance =>
  ({ id: "n1", type: "MidiPad", params: { channel: 1, baseNote: 36 } });

describe("#272 MidiPadNode 定義", () => {
  test("source カテゴリ・midiLearn / midiPad フラグ", () => {
    expect(MidiPadNode.type).toBe("MidiPad");
    expect(MidiPadNode.category).toBe("source");
    expect(MidiPadNode.midiLearn).toBe(true);
    expect(MidiPadNode.midiPad).toEqual({ rows: 4, cols: 4 });
  });

  test("出力は index / trigger / velocity の 3 本のみ（16 本の個別 trigger は持たない）", () => {
    // 個別配線は TriggerRouter を挟んで行う。ここでポートを 18 本に膨らませない。
    expect(MidiPadNode.outputs.map((o) => o.id)).toEqual(["index", "trigger", "velocity"]);
    const type = (id: string) => MidiPadNode.outputs.find((o) => o.id === id)!.type;
    expect(type("index")).toBe("number");
    expect(type("trigger")).toBe("trigger");
    expect(type("velocity")).toBe("number");
  });

  test("baseNote の既定は 36（GM ドラムの C1・多くのパッドの左上）", () => {
    expect(MidiPadNode.params.find((p) => p.id === "baseNote")!.default).toBe(36);
  });
});

describe("#272 MidiPad: パッド押下", () => {
  test("state 無しでも落ちない", () => {
    expect(MidiPadNode.evaluate(ctxFor(undefined)))
      .toEqual({ index: 0, trigger: false, velocity: 0 });
  });

  test("baseNote が index 0、そこから連番で 16 個を拾う", () => {
    const bus = new ControlBus();
    const rt = new MidiPadRuntime(bus);
    const node = assigned();
    MidiPadNode.evaluate(ctxFor(rt, node));
    bus.emit(noteOn(1, 36, 0.5));
    expect(MidiPadNode.evaluate(ctxFor(rt, node)))
      .toEqual({ index: 0, trigger: true, velocity: 0.5 });
    bus.emit(noteOn(1, 51, 1));
    expect(MidiPadNode.evaluate(ctxFor(rt, node)))
      .toEqual({ index: 15, trigger: true, velocity: 1 });
  });

  test("範囲外の note は無視する", () => {
    const bus = new ControlBus();
    const rt = new MidiPadRuntime(bus);
    const node = assigned();
    MidiPadNode.evaluate(ctxFor(rt, node));
    bus.emit(noteOn(1, 52));
    expect(MidiPadNode.evaluate(ctxFor(rt, node)).trigger).toBe(false);
  });

  test("index と velocity は次に叩かれるまで保持される", () => {
    const bus = new ControlBus();
    const rt = new MidiPadRuntime(bus);
    const node = assigned();
    MidiPadNode.evaluate(ctxFor(rt, node));
    bus.emit(noteOn(1, 38, 0.6));
    MidiPadNode.evaluate(ctxFor(rt, node));
    bus.emit(noteOff(1, 38));
    // 離しても index / velocity は保持し、trigger だけが下がる。
    expect(MidiPadNode.evaluate(ctxFor(rt, node)))
      .toEqual({ index: 2, trigger: false, velocity: 0.6 });
  });

  test("同フレームに複数パッドが叩かれたら最後に押された方を index にする", () => {
    const bus = new ControlBus();
    const rt = new MidiPadRuntime(bus);
    const node = assigned();
    MidiPadNode.evaluate(ctxFor(rt, node));
    bus.emit(noteOn(1, 37, 0.2));
    bus.emit(noteOn(1, 40, 0.9));
    expect(MidiPadNode.evaluate(ctxFor(rt, node)))
      .toEqual({ index: 4, trigger: true, velocity: 0.9 });
  });

  test("channel 0（omni）はどの ch のパッドでも拾う", () => {
    const bus = new ControlBus();
    const rt = new MidiPadRuntime(bus);
    const node: NodeInstance = { id: "n1", type: "MidiPad", params: { channel: 0, baseNote: 36 } };
    MidiPadNode.evaluate(ctxFor(rt, node));
    bus.emit(noteOn(10, 37));
    expect(MidiPadNode.evaluate(ctxFor(rt, node)).index).toBe(1);
  });
});

describe("#272 MidiPad: 押下インジケータ", () => {
  test("padGates は 16 個で、押下中のパッドだけ true", () => {
    const bus = new ControlBus();
    const rt = new MidiPadRuntime(bus);
    const node = assigned();
    MidiPadNode.evaluate(ctxFor(rt, node));
    expect(rt.padGates()).toHaveLength(MIDI_PAD_COUNT);
    expect(rt.padGates().some((g) => g)).toBe(false);
    bus.emit(noteOn(1, 39));
    MidiPadNode.evaluate(ctxFor(rt, node));
    expect(rt.padGates()[3]).toBe(true);
    expect(rt.padGates()[0]).toBe(false);
    bus.emit(noteOff(1, 39));
    MidiPadNode.evaluate(ctxFor(rt, node));
    expect(rt.padGates()[3]).toBe(false);
  });
});

describe("#272 MidiPad: Learn", () => {
  test("LEARN 後に叩いたパッドを左上（baseNote）として取り込む", () => {
    const bus = new ControlBus();
    const rt = new MidiPadRuntime(bus);
    const node: NodeInstance = { id: "n1", type: "MidiPad", params: { channel: 0, baseNote: 36 } };
    rt.learn.start(bus);
    bus.emit(noteOn(9, 44));
    MidiPadNode.evaluate(ctxFor(rt, node));
    expect(node.params.channel).toBe(9);
    expect(node.params.baseNote).toBe(44);
  });

  test("割当のために叩いた一撃では trigger を出さない", () => {
    const bus = new ControlBus();
    const rt = new MidiPadRuntime(bus);
    const node: NodeInstance = { id: "n1", type: "MidiPad", params: { channel: 0, baseNote: 36 } };
    rt.learn.start(bus);
    bus.emit(noteOn(9, 44));
    expect(MidiPadNode.evaluate(ctxFor(rt, node)).trigger).toBe(false);
    bus.emit(noteOn(9, 44));
    expect(MidiPadNode.evaluate(ctxFor(rt, node)).trigger).toBe(true);
  });
});
