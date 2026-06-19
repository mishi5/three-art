import { DEFAULT_AUDIO_FEATURES, type AudioFeatures } from "../types";
import { AudioAnalyzer } from "./AudioAnalyzer";
import type { AudioInput } from "./AudioInput";

/**
 * Chrome タブ音声を `getDisplayMedia` で取得して analyzer に繋ぐ AudioInput。
 * - video track は即 stop して捨てる（Chrome は audio-only を許可しない）
 * - destination には繋がない（タブ自体が元々スピーカーに鳴っているため聞こえ続ける）
 */
export class DisplayAudioSource implements AudioInput {
  private ctx: AudioContext;
  private analyzer: AudioAnalyzer;
  private stream: MediaStream | null = null;
  private node: MediaStreamAudioSourceNode | null = null;
  private active = false;
  private starting = false;
  /** #128: ルーティング用出力（`analyzer→outputGain`）。 */
  readonly output: GainNode;

  constructor(ctx: AudioContext, opts: { connectToDestination?: boolean } = {}) {
    this.ctx = ctx;
    this.analyzer = new AudioAnalyzer(ctx);
    this.output = ctx.createGain();
    this.analyzer.input.connect(this.output);
    // 既定で destination 非接続（タブ自体が元々鳴っているため二重再生防止）。
    if (opts.connectToDestination) {
      this.output.connect(ctx.destination);
    } else {
      // #128: 無音(gain 0)の keep-alive で解析グラフを生かす（可聴出力は Output ノード経由）。
      const keep = ctx.createGain();
      keep.gain.value = 0;
      this.output.connect(keep);
      keep.connect(ctx.destination);
    }
  }

  async start(): Promise<void> {
    if (this.starting || this.active) return;
    this.starting = true;
    try {
      // Chrome の音声処理パイプライン（echoCancellation / noiseSuppression /
      // autoGainControl）を明示的に OFF にしてキャプチャレイテンシを抑える。
      const stream = await navigator.mediaDevices.getDisplayMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        video: { width: 1, height: 1, frameRate: 1 },
      });
      for (const t of stream.getVideoTracks()) t.stop();
      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length === 0) {
        for (const t of stream.getTracks()) t.stop();
        throw new Error(
          "タブの音声共有が ON になっていません。Chrome タブを選び『タブの音声を共有』を有効にしてください",
        );
      }
      audioTracks[0]!.addEventListener("ended", () => {
        this.active = false;
      });
      this.stream = stream;
      this.node = this.ctx.createMediaStreamSource(stream);
      this.node.connect(this.analyzer.input);
      this.active = true;
    } finally {
      this.starting = false;
    }
  }

  stop(): void {
    if (this.node) {
      this.node.disconnect();
      this.node = null;
    }
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
    this.active = false;
  }

  read(): AudioFeatures {
    if (!this.active) return DEFAULT_AUDIO_FEATURES;
    return this.analyzer.read(this.ctx.sampleRate);
  }
}
