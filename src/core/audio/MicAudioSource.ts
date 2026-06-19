import { DEFAULT_AUDIO_FEATURES, type AudioFeatures } from "../types";
import { AudioAnalyzer } from "./AudioAnalyzer";
import type { AudioInput } from "./AudioInput";

export class MicAudioSource implements AudioInput {
  private ctx: AudioContext;
  private analyzer: AudioAnalyzer;
  private stream: MediaStream | null = null;
  private node: MediaStreamAudioSourceNode | null = null;
  private active = false;
  /** #128: ルーティング用出力（`analyzer→outputGain`）。 */
  readonly output: GainNode;

  constructor(ctx: AudioContext, opts: { connectToDestination?: boolean } = {}) {
    this.ctx = ctx;
    this.analyzer = new AudioAnalyzer(ctx);
    this.output = ctx.createGain();
    this.analyzer.input.connect(this.output);
    // マイクは既定で destination 非接続（ハウリング防止）。明示 true でのみ発音。
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
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      video: false,
    });
    this.node = this.ctx.createMediaStreamSource(this.stream);
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
