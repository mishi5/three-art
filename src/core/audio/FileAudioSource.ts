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

/**
 * 状態と内部時刻から現在の再生位置を算出。playing 中だけ ctxNow を使う。
 * loop=true（既定）は曲長で wrap、loop=false は曲末で duration に張り付く（#115）。
 */
export function computeCurrentTime(
  state: PlaybackState,
  playOffset: number,
  startedAt: number | null,
  ctxNow: number,
  duration: number,
  loop = true,
): number {
  if (state === "stopped") return 0;
  if (state === "paused") return playOffset;
  if (startedAt === null || duration <= 0) return 0;
  const t = playOffset + (ctxNow - startedAt);
  if (!loop) return Math.max(0, Math.min(t, duration));   // loop off: 曲末で停止位置に張り付く
  const raw = t % duration;
  return raw < 0 ? raw + duration : raw;
}

export class FileAudioSource implements AudioInput {
  private ctx: AudioContext;
  private analyzer: AudioAnalyzer;
  private source: AudioBufferSourceNode | null = null;
  private buffer: AudioBuffer | null = null;
  private state: PlaybackState = "stopped";
  /** #115: ループ再生 ON/OFF。既定 true。 */
  private loop = true;
  /** 曲頭からの累積位置 (秒)。pause/seek で更新。 */
  private playOffset = 0;
  /** state==="playing" 突入時の ctx.currentTime。それ以外は null。 */
  private startedAt: number | null = null;
  /** resume() の await 中フラグ。再エントリでの二重 spawn を防ぐ。 */
  private resumeInFlight = false;
  /** #128: ルーティング用出力（`analyzer→outputGain`）。 */
  readonly output: GainNode;

  // 既定は従来どおり destination 直結（pose-particles 後方互換）。node-vj は false にして
  // outputGain を audioSignal として Mix/Output ノードへ配線する。
  constructor(ctx: AudioContext, opts: { connectToDestination?: boolean } = {}) {
    this.ctx = ctx;
    this.analyzer = new AudioAnalyzer(ctx);
    this.output = ctx.createGain();
    this.analyzer.input.connect(this.output);
    if (opts.connectToDestination ?? true) {
      this.output.connect(ctx.destination);
    } else {
      // #128: 無音(gain 0)の keep-alive を destination へ繋ぎ、解析グラフを処理させる
      // （これが無いと BufferSource→analyser が pull されず特徴量がゼロになりうる）。
      // 可聴出力は output を Audio 出力ノードへ繋いだときのみ。
      const keep = ctx.createGain();
      keep.gain.value = 0;
      this.output.connect(keep);
      keep.connect(ctx.destination);
    }
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
    if (this.state !== "stopped") return; // 既に playing/paused なら no-op (二重 spawn 防止)
    this.spawnSource(0);
    this.playOffset = 0;
    this.startedAt = this.ctx.currentTime;
    this.state = "playing";
  }

  /** playing → paused。AudioBufferSourceNode を停止し offset を保存。 */
  pause(): void {
    if (this.state !== "playing" || !this.buffer) return;
    // computeCurrentTime と同じロジックを再利用して負 modulo を回避
    this.playOffset = computeCurrentTime(
      this.state,
      this.playOffset,
      this.startedAt,
      this.ctx.currentTime,
      this.buffer.duration,
      this.loop,
    );
    this.disposeSource();
    this.startedAt = null;
    this.state = "paused";
  }

  /** paused → playing。新規 BufferSource を offset から再生。
   *  ctx.resume() の await 中に再エントリしないよう resumeInFlight でガードする
   *  (二重 spawn による node リーク + 重複再生を防ぐ)。 */
  async resume(): Promise<void> {
    if (this.state !== "paused" || !this.buffer) return;
    if (this.resumeInFlight) return;
    this.resumeInFlight = true;
    try {
      if (this.ctx.state === "suspended") {
        try {
          await this.ctx.resume();
        } catch (e) {
          console.warn("[FileAudioSource] AudioContext.resume() failed", e);
          return; // state は paused のまま
        }
      }
      // await 中に pause/seek/stop が呼ばれて状態が変わった可能性をチェック
      if (this.state !== "paused") return;
      this.spawnSource(this.playOffset);
      this.startedAt = this.ctx.currentTime;
      this.state = "playing";
    } finally {
      this.resumeInFlight = false;
    }
  }

  togglePause(): void {
    if (this.state === "playing") this.pause();
    else if (this.state === "paused") void this.resume();
    // stopped は no-op
  }

  /** 任意状態で seek。playing なら新ノードに差し替え、paused なら playOffset のみ更新。 */
  seek(t: number): void {
    if (!this.buffer) return;
    const target = clampSeek(t, this.buffer.duration);
    if (this.state === "playing") {
      this.disposeSource();
      this.spawnSource(target);
      this.playOffset = target;
      this.startedAt = this.ctx.currentTime;
    } else if (this.state === "paused") {
      this.playOffset = target;
    }
    // stopped は no-op
  }

  isPlaying(): boolean {
    return this.state === "playing";
  }

  /** #115: ループ再生 ON/OFF。再生中の source にも即反映する。 */
  setLoop(loop: boolean): void {
    this.loop = loop;
    if (this.source) this.source.loop = loop;
  }

  stop(): void {
    this.disposeSource();
    this.state = "stopped";
    this.startedAt = null;
    this.playOffset = 0;
  }

  read(): AudioFeatures {
    if (this.state !== "playing") return DEFAULT_AUDIO_FEATURES;
    return this.analyzer.read(this.ctx.sampleRate);
  }

  /** 解析した AudioBuffer を返す。decode 前 / 解放後は null。 */
  getDecodedBuffer(): AudioBuffer | null {
    return this.buffer;
  }

  /** 再生開始からの経過秒。loop の場合は曲長で wrap する。stopped 中 / 未開始は 0。 */
  getCurrentTime(): number {
    return computeCurrentTime(
      this.state,
      this.playOffset,
      this.startedAt,
      this.ctx.currentTime,
      this.buffer?.duration ?? 0,
      this.loop,
    );
  }

  /** 内部用: 新しい AudioBufferSourceNode を作って再生開始。 */
  private spawnSource(offset: number): void {
    if (!this.buffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.loop = this.loop;
    // #128: 発音経路は constructor で確定済み（analyzer→outputGain[→destination]）。
    src.connect(this.analyzer.input);
    src.start(0, offset);
    this.source = src;
  }

  /** 内部用: 現 source を停止して破棄。 */
  private disposeSource(): void {
    if (!this.source) return;
    try {
      this.source.stop();
    } catch {
      /* already stopped */
    }
    this.source.disconnect();
    this.source = null;
  }
}
