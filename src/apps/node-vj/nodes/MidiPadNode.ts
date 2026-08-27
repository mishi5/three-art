// #272: MidiPad ノード。実機 MIDI パッドコントローラの 4×4 を 1 ノードで受ける。
// baseNote から 16 個連番で拾い、index / trigger / velocity を出す。
// **16 本の個別 trigger は持たせない**（ポートが 18 本に膨れる割に、TriggerRouter を挟めば
// 同じことができる）。既存の SamplePad / ClipLauncher を叩くなら index+trigger を
// padIndex/padTrig 入力へ 2 本繋ぐ。
import type { NodeState, NodeTypeDef } from "../graph/node-type";
import type { ControlBus } from "../midi/control-bus";
import { sharedMidi } from "../midi/shared-midi";
import {
  MIDI_PAD_COLS, MIDI_PAD_COUNT, MIDI_PAD_ROWS, MidiLearn, NoteEdge, type MidiLearnDisplay,
} from "./midi-node-logic";

/** step() の戻り値（出力ポート一式）。 */
export interface MidiPadOutputs {
  index: number;
  trigger: boolean;
  velocity: number;
}

/** #272: MidiPad の永続状態。16 パッド分の消費位置と、直近の押下（index/velocity）を持つ。 */
export class MidiPadRuntime {
  readonly learn = new MidiLearn();
  readonly bus: ControlBus;
  private edges = Array.from({ length: MIDI_PAD_COUNT }, () => new NoteEdge());
  /** 押下インジケータ用の gate（NodeEditor が毎フレーム引く）。 */
  private gates: boolean[] = new Array(MIDI_PAD_COUNT).fill(false);
  /** 直近に叩かれたパッド（次に叩かれるまで保持する）。 */
  private lastIndex = 0;
  private lastVelocity = 0;

  /** #272: 直近の評価で使った割当（UI 表示用。param を UI から辿らずに済ませる）。 */
  private lastChannel = 0;
  private lastNumber = 36;

  constructor(bus?: ControlBus) {
    this.bus = bus ?? sharedMidi.bus;
  }

  /** #272: LEARN ボタン（待機の開始/解除）。 */
  toggleLearn(): void {
    this.learn.toggle(this.bus);
  }

  /** #272: MIDI Learn 行の表示情報（NodeEditor が毎フレーム引く）。 */
  learnInfo(): MidiLearnDisplay {
    return {
      waiting: this.learn.waiting,
      status: sharedMidi.getStatus(),
      channel: this.lastChannel,
      number: this.lastNumber,
      kind: "note",
    };
  }

  /** 押下中のパッド（rows×cols 分・NodeEditor のインジケータ用）。 */
  padGates(): boolean[] {
    return this.gates;
  }

  /**
   * 1 フレーム分の読み出し。learn 待機中に叩かれたパッドは「左上（baseNote）」として取り込む。
   * 同フレームに複数パッドが叩かれた場合は **lastOnSeq が最大のもの**（＝最後に押された方）を
   * index に採る。velocity は発火した瞬間の値をラッチする（離鍵で 0 に戻らないように）。
   */
  step(
    channel: number, baseNote: number,
    onLearn: (channel: number, baseNote: number) => void,
  ): MidiPadOutputs {
    const learned = this.learn.poll(this.bus, "note");
    if (learned) onLearn(learned.channel, learned.number);
    const ch = learned?.channel ?? channel;
    const base = learned?.number ?? baseNote;
    this.lastChannel = ch;
    this.lastNumber = base;

    let trigger = false;
    let bestSeq = -1;
    for (let i = 0; i < MIDI_PAD_COUNT; i += 1) {
      const num = base + i;
      const state = this.bus.note(ch, num);
      this.gates[i] = state?.gate ?? false;
      if (!this.edges[i]!.poll(`${ch}:${num}`, state?.onCount ?? 0)) continue;
      trigger = true;
      const seq = state?.lastOnSeq ?? 0;
      if (seq > bestSeq) {
        bestSeq = seq;
        this.lastIndex = i;
        this.lastVelocity = state?.velocity ?? 0;
      }
    }
    return { index: this.lastIndex, trigger, velocity: this.lastVelocity };
  }
}

/** param を int として読む（未設定・不正は fallback）。 */
function intParam(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : fallback;
}

/** #272: 実機 MIDI パッド（4×4）を index / trigger / velocity に変換するノード。 */
export const MidiPadNode: NodeTypeDef = {
  type: "MidiPad",
  category: "source",
  description: "node.MidiPad.desc",
  midiLearn: true,
  midiPad: { rows: MIDI_PAD_ROWS, cols: MIDI_PAD_COLS },
  isSink: false,
  inputs: [],
  outputs: [
    { id: "index", label: "index", type: "number", description: "node.MidiPad.port.index" },
    { id: "trigger", label: "trig", type: "trigger", description: "node.MidiPad.port.trigger" },
    { id: "velocity", label: "vel", type: "number", description: "node.MidiPad.port.velocity" },
  ],
  params: [
    { id: "channel", label: "channel", kind: "int", default: 0, min: 0, max: 16, step: 1,
      noInput: true, description: "node.MidiPad.param.channel" },
    // 上限 112 = 127 - 15（16 個連番が 127 に収まる範囲）。
    { id: "baseNote", label: "baseNote", kind: "int", default: 36, min: 0, max: 112, step: 1,
      noInput: true, description: "node.MidiPad.param.baseNote" },
  ],
  createState: () => {
    void sharedMidi.start();
    return new MidiPadRuntime();
  },
  evaluate: (ctx) => {
    const s = ctx.state as MidiPadRuntime | undefined;
    if (!s) return { index: 0, trigger: false, velocity: 0 };
    return { ...s.step(
      intParam(ctx.param("channel"), 0),
      intParam(ctx.param("baseNote"), 36),
      (channel, baseNote) => {
        ctx.node.params.channel = channel;
        ctx.node.params.baseNote = baseNote;
      },
    ) };
  },
  disposeState: (_state: NodeState) => { /* 共有 MIDI はノード単位で止めない */ },
};
