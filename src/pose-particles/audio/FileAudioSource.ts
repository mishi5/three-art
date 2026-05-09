import { DEFAULT_AUDIO_FEATURES, type AudioFeatures } from "../types";
import { AudioAnalyzer } from "./AudioAnalyzer";
import type { AudioInput } from "./AudioInput";

/** seek 時刻を [0, duration) に clamp。NaN は 0 に倒し、Infinity は upper bound に張り付かせる。 */
export function clampSeek(t: number, duration: number): number {
  if (Number.isNaN(t)) return 0;
  if (duration <= 0) return 0;
  if (t === -Infinity || t < 0) return 0;
  const upper = duration - 1e-3;
  if (t === Infinity || t > upper) return upper;
  return t;
}

export type PlaybackState = "stopped" | "playing" | "paused";

/** 状態と内部時刻から現在の再生位置を算出。playing 中だけ ctxNow を使う。 */
export function computeCurrentTime(
  state: PlaybackState,
  playOffset: number,
  startedAt: number | null,
  ctxNow: number,
  duration: number,
): number {
  if (state === "stopped") return 0;
  if (state === "paused") return playOffset;
  if (startedAt === null || duration <= 0) return 0;
  const elapsed = ctxNow - startedAt;
  const raw = (playOffset + elapsed) % duration;
  return raw < 0 ? raw + duration : raw;
}

export class FileAudioSource implements AudioInput {
  private ctx: AudioContext;
  private analyzer: AudioAnalyzer;
  private source: AudioBufferSourceNode | null = null;
  private buffer: AudioBuffer | null = null;
  private playing = false;
  private startedAt: number | null = null;

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
    this.startedAt = this.ctx.currentTime;
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
    this.startedAt = null;
  }

  read(): AudioFeatures {
    if (!this.playing) return DEFAULT_AUDIO_FEATURES;
    return this.analyzer.read(this.ctx.sampleRate);
  }

  /** 解析した AudioBuffer を返す。decode 前 / 解放後は null。 */
  getDecodedBuffer(): AudioBuffer | null {
    return this.buffer;
  }

  /** 再生開始からの経過秒。loop の場合は曲長で wrap する。stop 中 / 未開始は 0。 */
  getCurrentTime(): number {
    if (!this.playing || this.startedAt === null || !this.buffer) return 0;
    const elapsed = this.ctx.currentTime - this.startedAt;
    const dur = this.buffer.duration;
    if (dur <= 0) return 0;
    return elapsed % dur;
  }
}
