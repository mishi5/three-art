// #205: クリック式の仮想サンプルパッドノード（4×4）。Web MIDI には非対応で、画面上のパッドをクリックすることで
// 各パッドに割り当てた音声ファイルをワンショット発音する。
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
 * #205: SamplePad の永続状態。各パッドの AudioBuffer を保持し、playPad でワンショット発音する。
 * 発音は createBufferSource→mixGain へ接続→start(0)。ended で active から除去。
 */
export class SamplePadRuntime {
  private ctx: AudioContext;
  /** 全パッドの合流先（master volume 兼用）。これを audio 出力として配線する。 */
  readonly mixGain: GainNode;
  private buffers: (AudioBuffer | null)[] = new Array(PAD_COUNT).fill(null);
  private fileNames: (string | null)[] = new Array(PAD_COUNT).fill(null);
  /** 発音中のソース → 鳴っているパッド index（dispose / stopAll で全停止・stopPad で個別停止）。 */
  private active = new Map<AudioBufferSourceNode, number>();
  /** #205: いずれかのパッドが押された（playPad された）ことを示すラッチ。evaluate で消費し 1 フレームだけ true を返す。 */
  private pressed = false;
  /** #272: padTrig 入力のエッジ検出用（前フレームの値）。 */
  private prevPadTrig = false;

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
    this.active.set(src, index);
    src.start(0);
  }

  /**
   * #272: padTrig 入力の立ち上がりで padIndex のパッドを鳴らす（MidiPad からの配線用）。
   * マウスクリック経路（main.ts）と同じ playPad を通るので、発音・trigger 出力の振る舞いは同じ。
   */
  padTriggerFromInput(index: unknown, trig: unknown): void {
    const now = Boolean(trig);
    const rising = now && !this.prevPadTrig;
    this.prevPadTrig = now;
    if (!rising) return;
    const i = Math.round(Number(index));
    if (Number.isFinite(i)) this.playPad(i);
  }

  /** #205: 指定パッドで発音中の音だけを停止する（再割当/解除のタイミングで古い音を切る）。 */
  stopPad(index: number): void {
    for (const [src, pad] of this.active) {
      if (pad !== index) continue;
      try { src.stop(); } catch { /* already stopped */ }
      try { src.disconnect(); } catch { /* ignore */ }
      this.active.delete(src);
    }
  }

  /** #205: パッドの割当を解除する（発音中の音を止め、buffer/ラベルを空に戻す）。padAssets は呼び出し側で消す。 */
  clearPad(index: number): void {
    if (index < 0 || index >= PAD_COUNT) return;
    this.stopPad(index);
    this.buffers[index] = null;
    this.fileNames[index] = null;
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
    for (const src of this.active.keys()) {
      try { src.stop(); } catch { /* already stopped */ }
      try { src.disconnect(); } catch { /* ignore */ }
    }
    this.active.clear();
  }

  /** 全発音停止・接続解放。 */
  dispose(): void {
    for (const src of this.active.keys()) {
      try { src.stop(); } catch { /* already stopped */ }
      try { src.disconnect(); } catch { /* ignore */ }
    }
    this.active.clear();
    try { this.mixGain.disconnect(); } catch { /* ignore */ }
  }
}

/** #205: クリック式の仮想サンプルパッドノード。4×4 のパッドに音声を割り当て、クリックでワンショット発音する。 */
export const SamplePadNode: NodeTypeDef = {
  type: "SamplePad",
  category: "source",
  description: "node.SamplePad.desc",
  isSink: false,
  padGrid: { rows: PAD_ROWS, cols: PAD_COLS },
  // #272: 実機 MIDI パッド（MidiPad）や BeatClock/TapSequencer から外部起動するための口。
  // padTrig の立ち上がりで padIndex のパッドを鳴らす。
  inputs: [
    { id: "padIndex", label: "padIdx", type: "number", description: "node.SamplePad.port.padIndex" },
    { id: "padTrig", label: "padTrig", type: "trigger", description: "node.SamplePad.port.padTrig" },
  ],
  outputs: [
    SIGNAL_OUTPUT,
    // #205: いずれかのパッド押下時に 1 フレームだけ発火する trigger（boolean）。Envelope/Flash 等へ繋げる。
    { id: "trigger", label: "trig", type: "trigger", description: "node.SamplePad.port.trigger" },
  ],
  params: [
    { id: "volume", label: "volume", kind: "number", default: 1, min: 0, max: 1, step: 0.01, description: "node.SamplePad.param.volume" },
    // 各パッドの割当アセット id（string[]・長さ可変・hidden）。アセットライブラリで永続化する。
    { id: "padAssets", label: "padAssets", kind: "string", default: [], noInput: true, hidden: true,
      description: "node.SamplePad.param.padAssets" },
  ],
  createState: (env: NodeEnv) => new SamplePadRuntime(env.audioContext),
  disposeState: (state: NodeState) => (state as SamplePadRuntime).dispose(),
  evaluate: (ctx) => {
    const s = ctx.state as SamplePadRuntime | undefined;
    if (!s) return { ...signalOutput(null), trigger: false };
    s.setVolume(Number(ctx.param("volume") ?? 1));
    // #272: 外部からのパッド起動（発音は下の押下ラッチ経由で trigger 出力にも乗る）。
    s.padTriggerFromInput(ctx.input("padIndex"), ctx.input("padTrig"));
    // #205: 押下ラッチを消費して trigger（boolean）として出力する（PulseNode と同じ表現）。
    return { ...signalOutput(s.mixGain), trigger: s.consumeTrigger() };
  },
};
