// #272: Web MIDI 接続を 1 箇所に集約する共有リソース（このモジュールが唯一の Web MIDI 依存）。
// SharedCamera（nodes/shared-camera.ts）と同じ「モジュール単一資源」の流儀:
// 各ノードの disposeState では止めない（シーン切替で MIDI が切れないように）。
import { ControlBus } from "./control-bus";
import { parseMidiMessage } from "./midi-message";

/** 接続状態。いずれも例外にせずステータス行に出し、ノードは既定値を出し続ける。 */
export type MidiStatus =
  /** まだ起動していない。 */
  | "idle"
  /** 起動中（権限プロンプト待ちを含む）。 */
  | "starting"
  /** ブラウザが Web MIDI に非対応。 */
  | "unsupported"
  /** 権限拒否。 */
  | "denied"
  /** 起動済みだが入力デバイスが 0 台。 */
  | "no-device"
  /** 入力デバイスあり。 */
  | "ready";

/** #272: Web MIDI アクセスの管理と、受信メッセージの ControlBus への流し込み。 */
export class SharedMidi {
  /** 全 MIDI 系ノードが読む正規化入力バス。 */
  readonly bus = new ControlBus();
  private status: MidiStatus = "idle";
  private access: MIDIAccess | null = null;
  /** 起動中の requestMIDIAccess。冪等 start のため保持する（多重要求を防ぐ）。 */
  private startPromise: Promise<void> | null = null;
  /** 購読済み入力ポート（statechange のたびに張り直す際の重複防止）。 */
  private attached = new WeakSet<MIDIInput>();

  /** 現在の接続状態。 */
  getStatus(): MidiStatus {
    return this.status;
  }

  /** 接続中の入力デバイス数。 */
  deviceCount(): number {
    return this.access ? this.access.inputs.size : 0;
  }

  /**
   * MIDI アクセスを開始する。冪等: 起動済みなら即 resolve、起動中なら同じ Promise を返す。
   * sysex は要求しない（不要なうえ権限が重くなる）。
   */
  start(): Promise<void> {
    if (this.access) return Promise.resolve();
    if (this.startPromise) return this.startPromise;
    const request = (navigator as Navigator | undefined)?.requestMIDIAccess;
    if (typeof request !== "function") {
      this.status = "unsupported";
      return Promise.resolve();
    }
    this.status = "starting";
    this.startPromise = request.call(navigator, { sysex: false })
      .then((access) => {
        this.access = access;
        access.onstatechange = () => this.attachInputs();
        this.attachInputs();
      })
      .catch(() => {
        // 権限拒否・その他の失敗。例外にせずステータスだけ落とす。
        this.status = "denied";
      })
      .finally(() => {
        this.startPromise = null;
      });
    return this.startPromise;
  }

  /**
   * 全入力ポートに onmidimessage を張る。statechange のたびに呼ばれ、
   * ライブ中にケーブルが抜けても再接続で復帰する（既に張ったポートは飛ばす）。
   */
  private attachInputs(): void {
    const access = this.access;
    if (!access) return;
    for (const input of access.inputs.values()) {
      if (this.attached.has(input)) continue;
      this.attached.add(input);
      input.onmidimessage = (e: MIDIMessageEvent) => {
        if (!e.data) return;
        const ev = parseMidiMessage(e.data);
        if (ev) this.bus.emit(ev);
      };
    }
    this.status = access.inputs.size > 0 ? "ready" : "no-device";
  }
}

/** 全 MIDI 系ノードが共有する単一インスタンス。 */
export const sharedMidi = new SharedMidi();
