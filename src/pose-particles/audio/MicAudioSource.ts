import { DEFAULT_AUDIO_FEATURES, type AudioFeatures } from "../types";
import { AudioAnalyzer } from "./AudioAnalyzer";
import type { AudioInput } from "./AudioInput";

export class MicAudioSource implements AudioInput {
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
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      video: false,
    });
    this.node = this.ctx.createMediaStreamSource(this.stream);
    // マイクは destination には繋がない（ハウリング防止）
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
