// #205: 簡易 MIDI パッドノード（4×4）。各パッドに音声ファイルを割り当て、クリックでワンショット発音する。
// 全パッドを 1 つの mix gain に合流し、audio 出力として AudioMix/AudioOutput へ流せる。
// 連続クリックのたびに新規 AudioBufferSourceNode を生成するため、前の音を切らずに重ねて鳴る。
import type { NodeEnv, NodeState, NodeTypeDef } from "../graph/node-type";
import { SIGNAL_OUTPUT, signalOutput } from "../graph/audio-signal";

/** パッド数（4×4）。 */
export const PAD_ROWS = 4;
export const PAD_COLS = 4;
export const PAD_COUNT = PAD_ROWS * PAD_COLS;

/** #205: パッドラベル用の短縮名。拡張子を落とす（描画側で更に省略表示する）。空/未割当は null。 */
export function shortPadLabel(name: string | null | undefined): string | null {
  if (!name) return null;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

/**
 * #205: MidiPad の永続状態。各パッドの AudioBuffer を保持し、playPad でワンショット発音する。
 * 発音は createBufferSource→mixGain へ接続→start(0)。ended で active から除去。
 */
export class MidiPadRuntime {
  private ctx: AudioContext;
  /** 全パッドの合流先（master volume 兼用）。これを audio 出力として配線する。 */
  readonly mixGain: GainNode;
  private buffers: (AudioBuffer | null)[] = new Array(PAD_COUNT).fill(null);
  private fileNames: (string | null)[] = new Array(PAD_COUNT).fill(null);
  /** 発音中のソース集合（dispose / stopAll で全停止）。 */
  private active = new Set<AudioBufferSourceNode>();
  /** #205: いずれかのパッドが押された（playPad された）ことを示すラッチ。evaluate で消費し 1 フレームだけ true を返す。 */
  private pressed = false;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.mixGain = ctx.createGain();
    this.mixGain.gain.value = 1;
  }

  /** #205: パッド index に音声ファイルを割り当てる（decode して保持）。 */
  async loadPadFile(index: number, file: File): Promise<void> {
    if (index < 0 || index >= PAD_COUNT) return;
    const arr = await file.arrayBuffer();
    const buffer = await this.ctx.decodeAudioData(arr);
    this.buffers[index] = buffer;
    this.fileNames[index] = file.name;
  }

  /** パッドに音が割り当て済みか。 */
  hasPad(index: number): boolean {
    return index >= 0 && index < PAD_COUNT && this.buffers[index] != null;
  }

  /** パッドの表示ラベル（短縮ファイル名・未割当は null）。 */
  padLabel(index: number): string | null {
    if (index < 0 || index >= PAD_COUNT) return null;
    return shortPadLabel(this.fileNames[index]);
  }

  /**
   * #205: パッド index をワンショット発音する。呼ぶたびに新規ソースを生成して mixGain へ繋ぐため、
   * 連続クリックで前の音を切らずに重ねて鳴る。未割当は no-op。
   */
  playPad(index: number): void {
    const buffer = this.buffers[index];
    if (!buffer) return;
    // #205: trigger 出力用に押下ラッチを立てる（次の evaluate で 1 フレーム発火）。
    this.pressed = true;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.mixGain);
    src.onended = () => {
      try { src.disconnect(); } catch { /* already disconnected */ }
      this.active.delete(src);
    };
    this.active.add(src);
    src.start(0);
  }

  /** master volume（0..1）を設定する。 */
  setVolume(v: number): void {
    this.mixGain.gain.value = Math.max(0, Math.min(1, v));
  }

  /**
   * #205: 直近フレームに押下があったかを返し、ラッチをリセットする（trigger 出力用）。
   * クリックは非同期・evaluate は毎フレームなので、押下→次の evaluate で 1 フレームだけ true になる。
   */
  consumeTrigger(): boolean {
    const p = this.pressed;
    this.pressed = false;
    return p;
  }

  /**
   * #205: 発音中の全ソースを停止・解放する（Stop ボタン）。mixGain は残すので以後も発音できる。
   */
  stopAll(): void {
    for (const src of this.active) {
      try { src.stop(); } catch { /* already stopped */ }
      try { src.disconnect(); } catch { /* ignore */ }
    }
    this.active.clear();
  }

  /** 全発音停止・接続解放。 */
  dispose(): void {
    for (const src of this.active) {
      try { src.stop(); } catch { /* already stopped */ }
      try { src.disconnect(); } catch { /* ignore */ }
    }
    this.active.clear();
    try { this.mixGain.disconnect(); } catch { /* ignore */ }
  }
}

/** #205: 簡易 MIDI パッドノード。4×4 のパッドに音声を割り当て、クリックでワンショット発音する。 */
export const MidiPadNode: NodeTypeDef = {
  type: "MidiPad",
  category: "input",
  description: "4×4 のパッドに音声ファイルを割り当て、クリックでワンショット発音する。連続クリックで重ねて鳴り、audio 出力を Audio Mix / Audio 出力へ繋げる。",
  isSink: false,
  padGrid: { rows: PAD_ROWS, cols: PAD_COLS },
  inputs: [],
  outputs: [
    SIGNAL_OUTPUT,
    // #205: いずれかのパッド押下時に 1 フレームだけ発火する trigger（boolean）。Envelope/Flash 等へ繋げる。
    { id: "trigger", label: "trig", type: "trigger", description: "いずれかのパッド押下時に1フレーム発火する trigger。" },
  ],
  params: [
    { id: "volume", label: "volume", kind: "number", default: 1, min: 0, max: 1, step: 0.01, description: "出力全体の音量（master・0〜1）。" },
    // 各パッドの割当アセット id（string[]・長さ可変・hidden）。アセットライブラリで永続化する。
    { id: "padAssets", label: "padAssets", kind: "string", default: [], noInput: true, hidden: true,
      description: "各パッドに割り当てたアセットの id 配列（slot=パッド番号・UI 非表示）。" },
  ],
  createState: (env: NodeEnv) => new MidiPadRuntime(env.audioContext),
  disposeState: (state: NodeState) => (state as MidiPadRuntime).dispose(),
  evaluate: (ctx) => {
    const s = ctx.state as MidiPadRuntime | undefined;
    if (!s) return { ...signalOutput(null), trigger: false };
    s.setVolume(Number(ctx.param("volume") ?? 1));
    // #205: 押下ラッチを消費して trigger（boolean）として出力する（PulseNode と同じ表現）。
    return { ...signalOutput(s.mixGain), trigger: s.consumeTrigger() };
  },
};
