// #272: MIDI バイト列 → 正規化 ControlEvent への変換（Web MIDI API 非依存の純関数）。
// ControlEvent は MIDI 固有の形にしない: 将来 OSC を足すときは「OSC アドレス → ControlEvent」の
// アダプタを 1 つ書いて同じ ControlBus へ流せば、ノード側は無改造で動く。

/** ノブ/フェーダー（Control Change）。value は 0..1 に正規化済み。 */
export interface CcEvent {
  kind: "cc";
  /** 1..16（UI 表示と一致させる。0 は omni＝全 ch の予約値として param 側で使う）。 */
  channel: number;
  /** CC 番号 0..127。 */
  number: number;
  /** 0..1。 */
  value: number;
}

/** パッド/鍵盤（Note On/Off）。velocity は 0..1 に正規化済み。 */
export interface NoteEvent {
  kind: "note";
  /** 1..16。 */
  channel: number;
  /** note 番号 0..127。 */
  number: number;
  /** 押下なら true。velocity 0 の Note On は false になる。 */
  on: boolean;
  /** 0..1（off のときは 0）。 */
  velocity: number;
}

/** MIDI/OSC 共通の正規化入力イベント。 */
export type ControlEvent = CcEvent | NoteEvent;

/** MIDI の 7bit 値（0..127）を 0..1 へ。 */
export function normalize7bit(v: number): number {
  return (v & 0x7f) / 127;
}

/**
 * #272: Web MIDI のバイト列を ControlEvent へ変換する。対象外・不正入力は null。
 * - 0xB0 = Control Change / 0x90 = Note On / 0x80 = Note Off のみ扱う。
 * - velocity 0 の Note On は Note Off として扱う（MIDI の慣習。多くのコントローラが
 *   離鍵をこの形で送るため、倒さないと gate が下がったままにならない）。
 * - ピッチベンド・アフタータッチ・MIDI クロック（0xF8）等は null。
 * - status バイト無し（ランニングステータス）は null。Web MIDI は常に status 付きで届く。
 */
export function parseMidiMessage(data: ArrayLike<number>): ControlEvent | null {
  if (data.length < 2) return null;
  const status = data[0]!;
  // 最上位ビットが立っていなければ status バイトではない（ランニングステータス）。
  if ((status & 0x80) === 0) return null;
  const type = status & 0xf0;
  const channel = (status & 0x0f) + 1;

  if (type === 0xb0) {
    if (data.length < 3) return null;
    return { kind: "cc", channel, number: data[1]! & 0x7f, value: normalize7bit(data[2]!) };
  }
  if (type === 0x90 || type === 0x80) {
    if (data.length < 3) return null;
    const number = data[1]! & 0x7f;
    const raw = data[2]! & 0x7f;
    const on = type === 0x90 && raw > 0;
    return { kind: "note", channel, number, on, velocity: on ? normalize7bit(raw) : 0 };
  }
  return null;
}
