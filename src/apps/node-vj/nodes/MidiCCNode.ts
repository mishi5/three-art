// #272: MidiCC ノード。実機 MIDI コントローラのノブ/フェーダー（Control Change）1 本を
// number 出力に変換する。param が入力ポート化されている（#74）ので、任意ノードの param へ配線できる。
// 平滑化 param は持たない（CC は 7bit で値が階段状になるが、後段に SmoothNode を繋げば済む）。
import type { NodeState, NodeTypeDef } from "../graph/node-type";
import type { ControlBus } from "../midi/control-bus";
import { sharedMidi } from "../midi/shared-midi";
import { MidiLearn, scaleCc } from "./midi-node-logic";

/** #272: MidiCC の永続状態。learn の待機状態を保持するだけで、値は ControlBus 側が持つ。 */
export class MidiCCRuntime {
  readonly learn = new MidiLearn();
  readonly bus: ControlBus;

  /** bus はテストで差し替えるために受け取る（既定は共有バス）。 */
  constructor(bus?: ControlBus) {
    this.bus = bus ?? sharedMidi.bus;
  }

  /**
   * 1 フレーム分の読み出し。learn 待機中に該当 CC が届いていれば onLearn で param へ書き戻し、
   * **そのフレームからその CC の値を出す**（書き戻した param が効くのを待って 1 フレーム遅れる、
   * ということがないように learn 結果を即座に使う）。未受信は min。
   */
  step(
    channel: number, cc: number, min: number, max: number,
    onLearn: (channel: number, cc: number) => void,
  ): number {
    const learned = this.learn.poll(this.bus, "cc");
    if (learned) onLearn(learned.channel, learned.number);
    const ch = learned?.channel ?? channel;
    const num = learned?.number ?? cc;
    const state = this.bus.cc(ch, num);
    return state ? scaleCc(state.value, min, max) : min;
  }
}

/** param を int として読む（未設定・不正は fallback）。 */
function intParam(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : fallback;
}

/** #272: MIDI CC（ノブ/フェーダー）を number 出力に変換するノード。 */
export const MidiCCNode: NodeTypeDef = {
  type: "MidiCC",
  category: "source",
  description: "node.MidiCC.desc",
  midiLearn: true,
  isSink: false,
  inputs: [],
  outputs: [{ id: "value", label: "value", type: "number", description: "node.MidiCC.port.value" }],
  params: [
    // 割当設定（配線対象ではないので noInput）。LEARN ボタンがここへ書き戻す。
    { id: "channel", label: "channel", kind: "int", default: 0, min: 0, max: 16, step: 1,
      noInput: true, description: "node.MidiCC.param.channel" },
    { id: "cc", label: "cc", kind: "int", default: 1, min: 0, max: 127, step: 1,
      noInput: true, description: "node.MidiCC.param.cc" },
    // 出力レンジ（配線して動かせる通常の number param）。
    { id: "min", label: "min", kind: "number", default: 0, min: -10, max: 10, step: 0.01,
      description: "node.MidiCC.param.min" },
    { id: "max", label: "max", kind: "number", default: 1, min: -10, max: 10, step: 0.01,
      description: "node.MidiCC.param.max" },
  ],
  createState: () => {
    // 冪等な遅延起動。権限拒否・非対応でも例外にせずステータスに出る。
    void sharedMidi.start();
    return new MidiCCRuntime();
  },
  evaluate: (ctx) => {
    const s = ctx.state as MidiCCRuntime | undefined;
    const min = Number(ctx.param("min") ?? 0);
    if (!s) return { value: Number.isFinite(min) ? min : 0 };
    const value = s.step(
      intParam(ctx.param("channel"), 0),
      intParam(ctx.param("cc"), 1),
      min,
      Number(ctx.param("max") ?? 1),
      (channel, cc) => {
        // BeatClock の BPM 書き戻しと同じ流儀（history 非経由）。YAML 永続化にも乗る。
        ctx.node.params.channel = channel;
        ctx.node.params.cc = cc;
      },
    );
    return { value };
  },
  disposeState: (_state: NodeState) => { /* 共有 MIDI はノード単位で止めない（SharedCamera と同じ） */ },
};
