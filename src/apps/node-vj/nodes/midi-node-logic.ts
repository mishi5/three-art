// #272: MIDI 系ノードの純ロジック（Web MIDI API / DOM 非依存）。
// ノード本体（MidiCC/MidiNote/MidiPad/TriggerRouter）はここと ControlBus を組み合わせるだけにし、
// 判断ロジックはすべてこの層でテストする。
import type { ControlBus } from "../midi/control-bus";
import type { MidiStatus } from "../midi/shared-midi";

/**
 * #272: MIDI Learn 行の表示情報（NodeEditor が毎フレーム引く）。
 * 割当（channel/number）はノード param が持つが、UI から param を辿らずに済むよう
 * ランタイムが直近の評価値をここに写して返す（BeatClock の status() と同じ流儀）。
 */
export interface MidiLearnDisplay {
  /** LEARN 待機中か。 */
  waiting: boolean;
  /** MIDI 接続状態。 */
  status: MidiStatus;
  /** 割当チャンネル（0 = omni）。 */
  channel: number;
  /** 割当番号（CC 番号 / note 番号）。 */
  number: number;
  /** 表示形式の切り替え。 */
  kind: "cc" | "note";
}

/** MidiPad のグリッド寸法（4×4）。 */
export const MIDI_PAD_ROWS = 4;
export const MIDI_PAD_COLS = 4;
export const MIDI_PAD_COUNT = MIDI_PAD_ROWS * MIDI_PAD_COLS;

/** TriggerRouter の出力本数（MidiPad の 4×4 と 1 対 1 で対応させる）。 */
export const ROUTER_OUTPUTS = 16;

/**
 * 0..1 の受信値を min..max へ線形写像する。min > max（反転レンジ）もそのまま通す
 * （ノブを回すと値が下がる使い方を許す）。非有限値は min にフォールバック。
 */
export function scaleCc(value01: number, min: number, max: number): number {
  if (!Number.isFinite(value01)) return min;
  return min + (max - min) * value01;
}

/** note 番号 → パッド index（baseNote が 0）。範囲外は null。 */
export function padIndexOf(noteNumber: number, baseNote: number, count: number): number | null {
  const idx = noteNumber - baseNote;
  return idx >= 0 && idx < count ? idx : null;
}

/** index（number 入力）+ offset → 出力番号。四捨五入し、範囲外・非有限は null（何も発火しない）。 */
export function routeIndex(index: number, offset: number, count: number): number | null {
  if (!Number.isFinite(index)) return null;
  const i = Math.round(index) + (Number.isFinite(offset) ? Math.round(offset) : 0);
  return i >= 0 && i < count ? i : null;
}

/**
 * #272: note-on の累積回数（ControlBus.onCount）の差分から trigger を立てる追跡器。
 * ControlBus 側にラッチを持たせない代わりに、各ノードがここで自分の消費位置を持つ。
 * - **1 フレームに 1 回ずつ消費**するので、1 フレームに 2 回叩かれても次フレームで発火が続く
 *   （連打を取りこぼさない）。
 * - 割当（ch/番号）が変わったらカウンタを張り直す。前の割当の回数を持ち越して誤発火しない。
 * - 初回は基準合わせのみで発火しない（ノード生成前に届いていた押下で暴発しない）。
 */
export class NoteEdge {
  private key: string | null = null;
  private count = 0;

  /** この key の現在の onCount を渡し、発火すべきかを返す。 */
  poll(key: string, onCount: number): boolean {
    if (this.key !== key) {
      this.key = key;
      this.count = onCount;
      return false;
    }
    if (onCount > this.count) {
      this.count += 1;
      return true;
    }
    // 減ることは無い（ControlBus.reset 後の張り直し用）。
    this.count = onCount;
    return false;
  }
}

/** learn で取り込んだ割当先。 */
export interface LearnTarget {
  channel: number;
  number: number;
}

/**
 * #272: MIDI Learn の状態機械。
 * start 時点の通番を覚え、以後 poll のたびに bus の直近イベントを見て
 * 「開始後に届いた」「種別が一致する」最初のイベントから ch/番号を取り出す。
 * ポーリング方式なので購読の解除漏れがなく、テストも同期的に書ける。
 */
export class MidiLearn {
  /** 待機開始時点の通番（待機していなければ null）。 */
  private startSeq: number | null = null;

  /** 待機中か。 */
  get waiting(): boolean {
    return this.startSeq !== null;
  }

  /** 待機に入る。 */
  start(bus: ControlBus): void {
    this.startSeq = bus.currentSeq();
  }

  /** 待機を解除する。 */
  cancel(): void {
    this.startSeq = null;
  }

  /** 待機の開始/解除を切り替える（LEARN ボタンのクリック 1 回に対応）。 */
  toggle(bus: ControlBus): void {
    if (this.waiting) this.cancel();
    else this.start(bus);
  }

  /**
   * 待機中なら割当先を取り出す。取り込めたら待機を抜ける。
   * kind が一致しないイベント（CC 待ちの note など）では待機を続ける。
   * note 待ちは **note on のみ**を見る（叩いた瞬間で決める。離鍵で確定すると
   * 押しっぱなしのまま次のノードを learn できない）。
   */
  poll(bus: ControlBus, kind: "cc" | "note"): LearnTarget | null {
    if (this.startSeq === null) return null;
    const last = bus.lastEvent();
    if (!last || last.seq <= this.startSeq) return null;
    const { ev } = last;
    if (ev.kind !== kind) return null;
    if (ev.kind === "note" && !ev.on) return null;
    this.startSeq = null;
    return { channel: ev.channel, number: ev.number };
  }
}
