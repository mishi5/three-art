import * as THREE from "three";
import { AudioAnalyzer } from "../../../core/audio/AudioAnalyzer";
import { DEFAULT_AUDIO_FEATURES, type AudioFeatures } from "../../../core/types";
import type { NodeState, NodeTypeDef } from "../graph/node-type";
import { PREVIEW_W, PREVIEW_H } from "../graph/preview";
import { containRect } from "../editor/fit";
import { VideoTextureSurface } from "../graph/video-surface";
import type { PlaybackControl } from "./playback";
import {
  AUDIO_FEATURE_OUTPUTS, ONSET_PARAMS, OnsetTracker,
  audioFeatureOutputs, readOnsetParams,
} from "./audio-feature-logic";

/**
 * VideoFileInput ノードの永続状態（#66）。動画ファイルをループ再生して texture を供給する。
 * ファイル読込は user gesture（下部バー）から呼ぶ。
 * #116: audio=on のとき、同一 <video> の音声を Web Audio へ取り込み、AudioFileInput 相当の
 * 音響特徴量（audio/各バンド/onset）を出力する。映像と音声が同一要素由来なのでずれない。
 */
export class VideoFileInputRuntime implements PlaybackControl {
  private video: HTMLVideoElement;
  private objectUrl: string | null = null;
  private surface = new VideoTextureSurface();
  private previewCanvas: HTMLCanvasElement | null = null;
  started = false;
  /** #99: ノード上に表示する現在のファイル名（未選択は null）。 */
  fileName: string | null = null;

  // --- #116 音声抽出 ---
  private audioCtx: AudioContext | null = null;
  /** MediaElementAudioSourceNode は要素ごとに 1 度しか生成できないため保持する。 */
  private mediaSource: MediaElementAudioSourceNode | null = null;
  private analyzer: AudioAnalyzer | null = null;
  private gain: GainNode | null = null;
  private onset = new OnsetTracker();
  /** 現在 audio 抽出が有効か（gain/muted の状態と一致）。 */
  private audioActive = false;

  constructor() {
    this.video = document.createElement("video");
    this.video.playsInline = true;
    this.video.muted = true;     // 自動再生のため必須
    this.video.loop = true;
    this.video.style.display = "none";
    document.body.appendChild(this.video);
  }

  /** 動画ファイルを読み込んで再生する（user gesture から）。 */
  async loadFile(file: File): Promise<void> {
    this.fileName = file.name;
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = URL.createObjectURL(file);
    this.video.src = this.objectUrl;
    await this.video.play();
    this.started = true;
  }

  setLoop(loop: boolean): void {
    this.video.loop = loop;
  }

  /**
   * #116: 音声抽出の ON/OFF。ON の初回に <video> を MediaElementAudioSourceNode 経由で
   * analyser + gain → destination へ接続する（source は要素ごとに 1 度のみ生成）。
   * source → analyser → gain → destination。OFF は gain=0 + muted で無音化（ノードは保持）。
   */
  setAudioEnabled(enabled: boolean): void {
    if (enabled === this.audioActive) return;
    if (enabled) {
      if (!this.started) return; // 読込前は何もしない（loadFile 後に有効化される）
      this.ensureAudioGraph();
      this.video.muted = false;
      if (this.gain) this.gain.gain.value = 1;
      void this.audioCtx?.resume().catch(() => { /* gesture 不足時は次回 */ });
      this.audioActive = true;
    } else {
      if (this.gain) this.gain.gain.value = 0;
      this.video.muted = true;
      this.audioActive = false;
    }
  }

  /** Web Audio グラフを 1 度だけ構築する。 */
  private ensureAudioGraph(): void {
    if (this.mediaSource) return;
    const ctx = (this.audioCtx ??= new AudioContext());
    this.analyzer = new AudioAnalyzer(ctx);
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.mediaSource = ctx.createMediaElementSource(this.video);
    this.mediaSource.connect(this.analyzer.input);
    this.analyzer.input.connect(this.gain);
    this.gain.connect(ctx.destination);
  }

  /** #116: 現在の音響特徴量（audio=off / 未構築時は無音デフォルト）。 */
  readAudio(): AudioFeatures {
    if (!this.audioActive || !this.analyzer || !this.audioCtx) return DEFAULT_AUDIO_FEATURES;
    return this.analyzer.read(this.audioCtx.sampleRate);
  }

  detectOnset(bass: number, t: number, threshold: number, cooldown: number): boolean {
    if (!this.audioActive) return false;
    return this.onset.detect(bass, t, threshold, cooldown);
  }

  // --- PlaybackControl（#99）---
  isPlaying(): boolean {
    return this.started && !this.video.paused;
  }

  togglePlay(): void {
    if (!this.started) return;
    if (this.video.paused) void this.video.play().catch(() => { /* ignore */ });
    else this.video.pause();
  }

  getCurrentTime(): number {
    return this.video.currentTime || 0;
  }

  getDuration(): number {
    return Number.isFinite(this.video.duration) ? this.video.duration : 0;
  }

  seek(t: number): void {
    const d = this.getDuration();
    this.video.currentTime = d > 0 ? Math.max(0, Math.min(t, d - 1e-3)) : 0;
  }

  /** 画面サイズ RT へ contain 描画した texture（アスペクト比の入口正規化）。 */
  getTexture(renderer: THREE.WebGLRenderer): THREE.Texture | null {
    if (!this.started) return null;
    return this.surface.render(renderer, this.video);
  }

  previewFrame(): CanvasImageSource | null {
    if (!this.started || this.video.videoWidth === 0) return null;
    if (!this.previewCanvas) {
      this.previewCanvas = document.createElement("canvas");
      this.previewCanvas.width = PREVIEW_W;
      this.previewCanvas.height = PREVIEW_H;
    }
    const ctx = this.previewCanvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, PREVIEW_W, PREVIEW_H);
    const fit = containRect(this.video.videoWidth, this.video.videoHeight, PREVIEW_W, PREVIEW_H);
    ctx.drawImage(this.video, fit.x, fit.y, fit.w, fit.h);
    return this.previewCanvas;
  }

  dispose(): void {
    this.surface.dispose();
    this.video.pause();
    this.mediaSource?.disconnect();
    this.gain?.disconnect();
    void this.audioCtx?.close().catch(() => { /* ignore */ });
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.video.remove();
  }
}

/** 動画ファイル入力ノード（#66/#116）。texture と（audio=on で）音響特徴量を出力する。 */
export const VideoFileInputNode: NodeTypeDef = {
  type: "VideoFileInput",
  category: "input",
  description: "動画ファイルをループ再生して映像 texture を出力するノード。audio=on で同一動画の音声から音響特徴量（audio/各バンド/onset）も出力する。",
  isSink: false,
  fileInput: { accept: "video/*" },
  inputs: [],
  outputs: [
    { id: "texture", label: "tex", type: "texture", description: "動画フレームのテクスチャ（アスペクト比を入口で正規化済み）。" },
    ...AUDIO_FEATURE_OUTPUTS,
  ],
  params: [
    { id: "loop", label: "loop", kind: "enum", default: "on", options: ["on", "off"], description: "ループ再生の ON/OFF。" },
    { id: "audio", label: "audio", kind: "enum", default: "off", options: ["off", "on"], description: "動画音声の抽出 ON/OFF。ON で音響特徴量を出力しスピーカーへも再生する（既定 OFF=無音・映像のみ）。" },
    ...ONSET_PARAMS,
  ],
  createState: () => new VideoFileInputRuntime(),
  disposeState: (state: NodeState) => (state as VideoFileInputRuntime).dispose(),
  previewSource: (state: NodeState) => (state as VideoFileInputRuntime).previewFrame(),
  evaluate: (ctx) => {
    const s = ctx.state as VideoFileInputRuntime | undefined;
    const audioOn = ctx.param("audio") === "on";
    if (!s) return audioFeatureOutputs(DEFAULT_AUDIO_FEATURES, false);
    s.setLoop(ctx.param("loop") !== "off");
    s.setAudioEnabled(audioOn);
    const texture = (ctx.env ? s.getTexture(ctx.env.renderer) : null) ?? undefined;
    if (!audioOn) return { texture, ...audioFeatureOutputs(DEFAULT_AUDIO_FEATURES, false) };
    const audio = s.readAudio();
    const { threshold, cooldown } = readOnsetParams(ctx.param);
    const onset = s.detectOnset(audio.bass, ctx.timeSec, threshold, cooldown);
    return { texture, ...audioFeatureOutputs(audio, onset) };
  },
};
