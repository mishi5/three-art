// #272: 正規化入力（MIDI/将来の OSC）の状態を保持するバス。
// MIDI イベントは非同期に届くが evaluate は毎フレーム同期で回る。この段差を吸収するため、
// bus は購読コールバックを持たず「状態を保持してノードがポーリングする」形にする
// （evaluate の実行モデルとそのまま噛み合い、テストも同期的に書ける）。
import type { ControlEvent } from "./midi-message";

/** CC の保持状態。 */
export interface CcState {
  /** 0..1 に正規化済みの最新値。 */
  value: number;
  /** この値を受けたときの通番。 */
  seq: number;
}

/** Note の保持状態。 */
export interface NoteState {
  /** 押下中か。 */
  gate: boolean;
  /** 押下中の velocity 0..1（離鍵時は 0）。 */
  velocity: number;
  /**
   * note on を受けた累積回数。**消費しない**のがこの設計の要。
   * ラッチ（読んだら消える）にすると、同じ note を複数ノードが見ているとき
   * 最初に読んだ 1 ノードだけが発火してしまう。各ノードが「前フレームの onCount」を
   * 自分の runtime に持ち、差分で発火判定することで独立に受け取れる。
   * 差分方式なので 1 フレームに 2 回叩かれても取りこぼさない。
   */
  onCount: number;
  /** 最後に note on を受けたときの通番（MidiPad が「最後に押されたパッド」を選ぶのに使う）。 */
  lastOnSeq: number;
}

/** ch と番号から内部キーを作る。ch=0 は omni（全 ch）用の集約先。 */
function key(channel: number, number: number): string {
  return `${channel}:${number}`;
}

/** #272: 正規化入力の状態保持バス。emit で書き、cc()/note() でポーリングする。 */
export class ControlBus {
  private seq = 0;
  private ccStates = new Map<string, CcState>();
  private noteStates = new Map<string, NoteState>();
  private last: { ev: ControlEvent; seq: number } | null = null;

  /**
   * イベントを取り込む。**ch 別と omni（ch=0）の両方へ書き込む**ので、
   * 読む側はキーを作るだけでよく omni の分岐がロジックから消える。
   */
  emit(ev: ControlEvent): void {
    this.seq += 1;
    this.last = { ev, seq: this.seq };
    const channels = [ev.channel, 0];
    if (ev.kind === "cc") {
      for (const ch of channels) {
        this.ccStates.set(key(ch, ev.number), { value: ev.value, seq: this.seq });
      }
      return;
    }
    for (const ch of channels) {
      const k = key(ch, ev.number);
      const prev = this.noteStates.get(k);
      this.noteStates.set(k, {
        gate: ev.on,
        velocity: ev.on ? ev.velocity : 0,
        onCount: (prev?.onCount ?? 0) + (ev.on ? 1 : 0),
        lastOnSeq: ev.on ? this.seq : (prev?.lastOnSeq ?? 0),
      });
    }
  }

  /** 現在の通番。learn 開始時点を覚えるのに使う。 */
  currentSeq(): number {
    return this.seq;
  }

  /** 最後に届いたイベントと通番（learn 用）。未受信なら null。 */
  lastEvent(): { ev: ControlEvent; seq: number } | null {
    return this.last;
  }

  /** CC の最新状態。channel 0 は omni。未受信は undefined。 */
  cc(channel: number, number: number): CcState | undefined {
    return this.ccStates.get(key(channel, number));
  }

  /** Note の最新状態。channel 0 は omni。未受信は undefined。 */
  note(channel: number, number: number): NoteState | undefined {
    return this.noteStates.get(key(channel, number));
  }

  /**
   * 保持状態を捨てる。**seq は巻き戻さない**（巻き戻すと learn 待機中のノードが
   * 開始前のイベントを「開始後に届いた」と誤認して拾ってしまう）。
   */
  reset(): void {
    this.ccStates.clear();
    this.noteStates.clear();
    this.last = null;
  }
}
