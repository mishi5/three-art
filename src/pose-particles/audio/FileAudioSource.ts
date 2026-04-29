import { DEFAULT_AUDIO_FEATURES, type AudioFeatures } from "../types";
import { AudioAnalyzer } from "./AudioAnalyzer";
import type { AudioInput } from "./AudioInput";

export class FileAudioSource implements AudioInput {
  private ctx: AudioContext;
  private analyzer: AudioAnalyzer;
  private source: AudioBufferSourceNode | null = null;
  private buffer: AudioBuffer | null = null;
  private playing = false;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.analyzer = new AudioAnalyzer(ctx);
  }

  async loadFromUrl(url: string): Promise<void> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`failed to fetch audio: ${res.status}`);
    const arr = await res.arrayBuffer();
    this.buffer = await this.ctx.decodeAudioData(arr);
  }

  async loadFromFile(file: File): Promise<void> {
    const arr = await file.arrayBuffer();
    this.buffer = await this.ctx.decodeAudioData(arr);
  }

  async start(): Promise<void> {
    if (!this.buffer) throw new Error("no audio buffer loaded");
    this.source = this.ctx.createBufferSource();
    this.source.buffer = this.buffer;
    this.source.loop = true;
    this.source.connect(this.analyzer.input).connect(this.ctx.destination);
    this.source.start(0);
    this.playing = true;
  }

  stop(): void {
    if (this.source) {
      try {
        this.source.stop();
      } catch {
        /* already stopped */
      }
      this.source.disconnect();
      this.source = null;
    }
    this.playing = false;
  }

  read(): AudioFeatures {
    if (!this.playing) return DEFAULT_AUDIO_FEATURES;
    return this.analyzer.read(this.ctx.sampleRate);
  }
}
