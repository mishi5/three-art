// #272: MidiNote ノード。実機 MIDI のパッド/鍵盤 1 つを trigger / gate / velocity に変換する。
// パッドごとに違うものを叩きたい場合は、このノードを必要な数だけ置いて個別配線する
// （1 ノード = 1 パッドなので、どのパッドが何に効いているかがグラフ上でそのまま読める）。
import type { NodeState, NodeTypeDef } from "../graph/node-type";
import type { ControlBus } from "../midi/control-bus";
import { sharedMidi } from "../midi/shared-midi";
import { MidiLearn, NoteEdge } from "./midi-node-logic";

/** step() の戻り値（出力ポート一式）。 */
export interface MidiNoteOutputs {
  trigger: boolean;
  gate: number;
  velocity: number;
}

/** #272: MidiNote の永続状態。learn の待機と note-on の消費位置を持つ。 */
export class MidiNoteRuntime {
  readonly learn = new MidiLearn();
  readonly bus: ControlBus;
  private edge = new NoteEdge();

  constructor(bus?: ControlBus) {
    this.bus = bus ?? sharedMidi.bus;
  }

  /**
   * 1 フレーム分の読み出し。learn 待機中に叩かれた note があれば onLearn で param へ書き戻す。
   * 割当のために叩いた一撃では trigger を出さない（NoteEdge が割当変更で基準を張り直すため）。
   */
  step(
    channel: number, note: number,
    onLearn: (channel: number, note: number) => void,
  ): MidiNoteOutputs {
    const learned = this.learn.poll(this.bus, "note");
    if (learned) onLearn(learned.channel, learned.number);
    const ch = learned?.channel ?? channel;
    const num = learned?.number ?? note;
    const state = this.bus.note(ch, num);
    const trigger = this.edge.poll(`${ch}:${num}`, state?.onCount ?? 0);
    return {
      trigger,
      gate: state?.gate ? 1 : 0,
      velocity: state?.velocity ?? 0,
    };
  }
}

/** param を int として読む（未設定・不正は fallback）。 */
function intParam(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : fallback;
}

/** #272: MIDI の note（パッド/鍵盤）を trigger / gate / velocity に変換するノード。 */
export const MidiNoteNode: NodeTypeDef = {
  type: "MidiNote",
  category: "source",
  description: "node.MidiNote.desc",
  midiLearn: true,
  isSink: false,
  inputs: [],
  outputs: [
    { id: "trigger", label: "trig", type: "trigger", description: "node.MidiNote.port.trigger" },
    { id: "gate", label: "gate", type: "number", description: "node.MidiNote.port.gate" },
    { id: "velocity", label: "vel", type: "number", description: "node.MidiNote.port.velocity" },
  ],
  params: [
    { id: "channel", label: "channel", kind: "int", default: 0, min: 0, max: 16, step: 1,
      noInput: true, description: "node.MidiNote.param.channel" },
    { id: "note", label: "note", kind: "int", default: 36, min: 0, max: 127, step: 1,
      noInput: true, description: "node.MidiNote.param.note" },
  ],
  createState: () => {
    void sharedMidi.start();
    return new MidiNoteRuntime();
  },
  evaluate: (ctx) => {
    const s = ctx.state as MidiNoteRuntime | undefined;
    if (!s) return { trigger: false, gate: 0, velocity: 0 };
    return { ...s.step(
      intParam(ctx.param("channel"), 0),
      intParam(ctx.param("note"), 36),
      (channel, note) => {
        ctx.node.params.channel = channel;
        ctx.node.params.note = note;
      },
    ) };
  },
  disposeState: (_state: NodeState) => { /* 共有 MIDI はノード単位で止めない */ },
};
