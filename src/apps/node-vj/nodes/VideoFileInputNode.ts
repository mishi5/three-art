import * as THREE from "three";
import type { NodeState, NodeTypeDef } from "../graph/node-type";
import { PREVIEW_W, PREVIEW_H } from "../graph/preview";
import { containRect } from "../editor/fit";
import { VideoTextureSurface } from "../graph/video-surface";
import type { PlaybackControl } from "./playback";

/**
 * VideoFileInput ノードの永続状態（#66）。動画ファイルをループ再生して
 * texture を供給する。ファイル読込は user gesture（下部バー）から呼ぶ。
 * 音声トラックは対象外（音は AudioInput の file で扱う）。
 */
export class VideoFileInputRuntime implements PlaybackControl {
  private video: HTMLVideoElement;
  private objectUrl: string | null = null;
  private surface = new VideoTextureSurface();
  private previewCanvas: HTMLCanvasElement | null = null;
  started = false;
  /** #99: ノード上に表示する現在のファイル名（未選択は null）。 */
  fileName: string | null = null;

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
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.video.remove();
  }
}

/** 動画ファイル入力ノード（#66）。texture を出力する。 */
export const VideoFileInputNode: NodeTypeDef = {
  type: "VideoFileInput",
  category: "input",
  isSink: false,
  fileInput: { accept: "video/*" },
  inputs: [],
  outputs: [{ id: "texture", label: "tex", type: "texture" }],
  params: [
    { id: "loop", label: "loop", kind: "enum", default: "on", options: ["on", "off"] },
  ],
  createState: () => new VideoFileInputRuntime(),
  disposeState: (state: NodeState) => (state as VideoFileInputRuntime).dispose(),
  previewSource: (state: NodeState) => (state as VideoFileInputRuntime).previewFrame(),
  evaluate: (ctx) => {
    const s = ctx.state as VideoFileInputRuntime | undefined;
    if (!s) return {};
    s.setLoop(ctx.param("loop") !== "off");
    return { texture: (ctx.env ? s.getTexture(ctx.env.renderer) : null) ?? undefined };
  },
};
