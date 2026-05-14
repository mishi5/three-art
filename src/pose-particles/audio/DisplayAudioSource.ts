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

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.analyzer = new AudioAnalyzer(ctx);
  }

  async start(): Promise<void> {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      audio: true,
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
    this.stream = stream;
    this.node = this.ctx.createMediaStreamSource(stream);
    this.node.connect(this.analyzer.input);
    this.active = true;
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
