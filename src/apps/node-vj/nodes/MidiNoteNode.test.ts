// #272: MidiNote ノード（note → trigger / gate / velocity）のテスト。
import { describe, expect, test } from "bun:test";
import { MidiNoteNode, MidiNoteRuntime } from "./MidiNoteNode";
import { ControlBus } from "../midi/control-bus";
import type { EvalContext } from "../graph/node-type";
import type { NodeInstance } from "../graph/graph-doc";

function ctxFor(state: MidiNoteRuntime | undefined, node?: NodeInstance): EvalContext {
  const n = node ?? { id: "n1", type: "MidiNote", params: {} };
  return {
    timeSec: 0,
    input: () => undefined,
    param: (id: string) =>
      id in n.params ? n.params[id] : MidiNoteNode.params.find((p) => p.id === id)?.default,
    node: n,
    state,
  };
}

const noteOn = (channel: number, number: number, velocity = 1) =>
  ({ kind: "note", channel, number, on: true, velocity }) as const;
const noteOff = (channel: number, number: number) =>
  ({ kind: "note", channel, number, on: false, velocity: 0 }) as const;

/** ch1 / note36 に割り当てたノード。 */
const assigned = (): NodeInstance =>
  ({ id: "n1", type: "MidiNote", params: { channel: 1, note: 36 } });

describe("#272 MidiNoteNode 定義", () => {
  test("source カテゴリ・midiLearn フラグ・trigger/gate/velocity 出力", () => {
    expect(MidiNoteNode.type).toBe("MidiNote");
    expect(MidiNoteNode.category).toBe("source");
    expect(MidiNoteNode.midiLearn).toBe(true);
    expect(MidiNoteNode.outputs.map((o) => o.id)).toEqual(["trigger", "gate", "velocity"]);
    const type = (id: string) => MidiNoteNode.outputs.find((o) => o.id === id)!.type;
    expect(type("trigger")).toBe("trigger");
    expect(type("gate")).toBe("number");
    expect(type("velocity")).toBe("number");
  });

  test("channel / note は noInput", () => {
    for (const id of ["channel", "note"]) {
      expect(MidiNoteNode.params.find((p) => p.id === id)!.noInput).toBe(true);
    }
  });
});

describe("#272 MidiNote: 発火とゲート", () => {
  test("state 無しでも落ちない", () => {
    expect(MidiNoteNode.evaluate(ctxFor(undefined))).toEqual({ trigger: false, gate: 0, velocity: 0 });
  });

  test("未受信は発火せず gate 0", () => {
    const rt = new MidiNoteRuntime(new ControlBus());
    expect(MidiNoteNode.evaluate(ctxFor(rt, assigned())))
      .toEqual({ trigger: false, gate: 0, velocity: 0 });
  });

  test("note on で 1 フレームだけ trigger が立ち、gate と velocity は押下中 保持される", () => {
    const bus = new ControlBus();
    const rt = new MidiNoteRuntime(bus);
    const node = assigned();
    MidiNoteNode.evaluate(ctxFor(rt, node)); // 基準合わせ
    bus.emit(noteOn(1, 36, 0.8));
    expect(MidiNoteNode.evaluate(ctxFor(rt, node)))
      .toEqual({ trigger: true, gate: 1, velocity: 0.8 });
    // 次フレームは trigger が下がるが gate は保持。
    expect(MidiNoteNode.evaluate(ctxFor(rt, node)))
      .toEqual({ trigger: false, gate: 1, velocity: 0.8 });
  });

  test("note off で gate と velocity が 0 に戻る", () => {
    const bus = new ControlBus();
    const rt = new MidiNoteRuntime(bus);
    const node = assigned();
    bus.emit(noteOn(1, 36, 0.8));
    MidiNoteNode.evaluate(ctxFor(rt, node));
    bus.emit(noteOff(1, 36));
    expect(MidiNoteNode.evaluate(ctxFor(rt, node)))
      .toEqual({ trigger: false, gate: 0, velocity: 0 });
  });

  test("1 フレームに 2 回叩かれても発火を取りこぼさない（次フレームも発火する）", () => {
    const bus = new ControlBus();
    const rt = new MidiNoteRuntime(bus);
    const node = assigned();
    MidiNoteNode.evaluate(ctxFor(rt, node)); // 基準合わせ
    bus.emit(noteOn(1, 36));
    bus.emit(noteOff(1, 36));
    bus.emit(noteOn(1, 36));
    expect(MidiNoteNode.evaluate(ctxFor(rt, node)).trigger).toBe(true);
    expect(MidiNoteNode.evaluate(ctxFor(rt, node)).trigger).toBe(true);
    expect(MidiNoteNode.evaluate(ctxFor(rt, node)).trigger).toBe(false);
  });

  test("同じ note を 2 ノードが見ていても、それぞれ独立に発火する", () => {
    // ControlBus が消費ラッチでなく onCount 差分方式である理由。
    const bus = new ControlBus();
    const a = new MidiNoteRuntime(bus);
    const b = new MidiNoteRuntime(bus);
    const na = assigned();
    const nb: NodeInstance = { id: "n2", type: "MidiNote", params: { channel: 1, note: 36 } };
    MidiNoteNode.evaluate(ctxFor(a, na));
    MidiNoteNode.evaluate(ctxFor(b, nb));
    bus.emit(noteOn(1, 36));
    expect(MidiNoteNode.evaluate(ctxFor(a, na)).trigger).toBe(true);
    expect(MidiNoteNode.evaluate(ctxFor(b, nb)).trigger).toBe(true);
  });

  test("ノード生成前に届いていた押下では発火しない", () => {
    const bus = new ControlBus();
    bus.emit(noteOn(1, 36));
    const rt = new MidiNoteRuntime(bus);
    expect(MidiNoteNode.evaluate(ctxFor(rt, assigned())).trigger).toBe(false);
  });

  test("割当を変えた直後は発火しない（前の割当の回数を持ち越さない）", () => {
    const bus = new ControlBus();
    const rt = new MidiNoteRuntime(bus);
    const node = assigned();
    bus.emit(noteOn(1, 36));
    MidiNoteNode.evaluate(ctxFor(rt, node));
    bus.emit(noteOn(1, 40));
    bus.emit(noteOn(1, 40));
    node.params.note = 40;
    expect(MidiNoteNode.evaluate(ctxFor(rt, node)).trigger).toBe(false);
    bus.emit(noteOn(1, 40));
    expect(MidiNoteNode.evaluate(ctxFor(rt, node)).trigger).toBe(true);
  });

  test("channel 0（omni）はどの ch の note でも拾う", () => {
    const bus = new ControlBus();
    const rt = new MidiNoteRuntime(bus);
    const node: NodeInstance = { id: "n1", type: "MidiNote", params: { channel: 0, note: 36 } };
    MidiNoteNode.evaluate(ctxFor(rt, node));
    bus.emit(noteOn(10, 36));
    expect(MidiNoteNode.evaluate(ctxFor(rt, node)).trigger).toBe(true);
  });
});

describe("#272 MidiNote: Learn", () => {
  test("LEARN 後に叩いた note の ch/番号を params へ書き戻す", () => {
    const bus = new ControlBus();
    const rt = new MidiNoteRuntime(bus);
    const node: NodeInstance = { id: "n1", type: "MidiNote", params: { channel: 0, note: 60 } };
    rt.learn.start(bus);
    bus.emit(noteOn(9, 44));
    MidiNoteNode.evaluate(ctxFor(rt, node));
    expect(node.params.channel).toBe(9);
    expect(node.params.note).toBe(44);
  });

  test("割当のために叩いた一撃では trigger を出さない", () => {
    const bus = new ControlBus();
    const rt = new MidiNoteRuntime(bus);
    const node: NodeInstance = { id: "n1", type: "MidiNote", params: { channel: 0, note: 60 } };
    rt.learn.start(bus);
    bus.emit(noteOn(9, 44));
    expect(MidiNoteNode.evaluate(ctxFor(rt, node)).trigger).toBe(false);
    bus.emit(noteOn(9, 44));
    expect(MidiNoteNode.evaluate(ctxFor(rt, node)).trigger).toBe(true);
  });
});
