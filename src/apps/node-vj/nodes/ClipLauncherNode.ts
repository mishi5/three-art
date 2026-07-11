// #281: クリップランチャーノード（SamplePad の映像版）。4×4 パッドに動画/画像を割り当て、
// パッド押下で texture 出力をそのクリップへ切り替える。sync（trigger）接続時は押下を
// 「アーム（予約）」とし、sync の立ち上がりエッジで切り替える（クオンタイズ起動）。未接続なら即時切替。
// 音声は扱わない（video は muted 常時＝自動再生と evaluate 内 play() の許可に必須。
// 音は SamplePad / AudioFileInput の担当）。
import type * as THREE from "three";
import type { NodeState, NodeTypeDef } from "../graph/node-type";
import { PREVIEW_W, PREVIEW_H } from "../graph/preview";
import { containRect } from "../editor/fit";
import { VideoTextureSurface } from "../graph/video-surface";
import { ImageTextureSurface } from "../graph/image-surface";
import { shortPadLabel } from "./SamplePadNode";
import { resolveLaunch } from "./clip-launcher-logic";

/** パッド数（4×4・SamplePad と同寸）。 */
export const CLIP_PAD_ROWS = 4;
export const CLIP_PAD_COLS = 4;
export const CLIP_PAD_COUNT = CLIP_PAD_ROWS * CLIP_PAD_COLS;

/** パッドに割り当てたクリップ（動画 or 画像）。 */
type Clip =
  | { kind: "video"; video: HTMLVideoElement; url: string; name: string }
  | { kind: "image"; image: HTMLImageElement; url: string; name: string };

/**
 * #281: DOM/objectURL 依存の注入点。bun test では video/Image の実挙動が信頼できないため、
 * 要素生成とファイル URL 管理を差し替えられるようにする（既定は domClipMediaDeps）。
 */
export interface ClipMediaDeps {
  /** video 要素を作る（既定: display:none で body へ追加）。muted 等の設定は Runtime 側で行う。 */
  createVideo(): HTMLVideoElement;
  /** 画像を読み込む（既定: new Image() + onload）。 */
  loadImage(url: string): Promise<HTMLImageElement>;
  createObjectURL(file: File): string;
  revokeObjectURL(url: string): void;
}

/** 既定の DOM 実装。 */
export function domClipMediaDeps(): ClipMediaDeps {
  return {
    createVideo() {
      const v = document.createElement("video");
      v.style.display = "none";
      document.body.appendChild(v);
      return v;
    },
    loadImage(url: string) {
      return new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("failed to load image"));
        img.src = url;
      });
    },
    createObjectURL: (file) => URL.createObjectURL(file),
    revokeObjectURL: (url) => URL.revokeObjectURL(url),
  };
}

/**
 * #281: ClipLauncher の永続状態。main.ts の PadLoadable duck-type
 * （loadPadFile/playPad/hasPad/padLabel/stopAll/stopPad/clearPad）を実装し、
 * D&D 割当・パッドオーバーレイ・アセット復元（padAssets）を SamplePad と共通の配線で受ける。
 * 切替の実行はフレーム同期が要るため playPad は pending を立てるだけにし、
 * evaluate から毎フレーム呼ばれる step() が resolveLaunch で確定する。
 */
export class ClipLauncherRuntime {
  private deps: ClipMediaDeps;
  private clips: (Clip | null)[] = new Array(CLIP_PAD_COUNT).fill(null);
  /** 押下されたが未消費のパッド（sync 接続時はアーム表示・未接続なら次 step で切替）。 */
  private pending: number | null = null;
  private active: number | null = null;
  private prevSync = false;
  private videoSurface = new VideoTextureSurface();
  private imageSurface = new ImageTextureSurface();
  private previewCanvas: HTMLCanvasElement | null = null;

  constructor(deps: ClipMediaDeps = domClipMediaDeps()) {
    this.deps = deps;
  }

  /** #281: パッド index に動画/画像ファイルを割り当てる（動画は preload のみ・再生しない）。 */
  async loadPadFile(index: number, file: File): Promise<void> {
    if (index < 0 || index >= CLIP_PAD_COUNT) return;
    const url = this.deps.createObjectURL(file);
    let clip: Clip;
    if (file.type.startsWith("image/")) {
      let image: HTMLImageElement;
      try {
        image = await this.deps.loadImage(url);
      } catch (e) {
        this.deps.revokeObjectURL(url);
        throw e;
      }
      clip = { kind: "image", image, url, name: file.name };
    } else {
      const video = this.deps.createVideo();
      // muted は自動再生ポリシーと evaluate 内（gesture 外）の play() 許可のため常時必須。
      video.muted = true;
      video.playsInline = true;
      video.preload = "auto";
      video.src = url;
      clip = { kind: "video", video, url, name: file.name };
    }
    // 再割当は古いクリップを破棄してから差し替える（アクティブ/アーム解除も含む）。
    if (this.clips[index]) this.clearPad(index);
    this.clips[index] = clip;
  }

  /** パッドにクリップが割り当て済みか。 */
  hasPad(index: number): boolean {
    return index >= 0 && index < CLIP_PAD_COUNT && this.clips[index] != null;
  }

  /** パッドの表示ラベル（短縮ファイル名・未割当は null）。 */
  padLabel(index: number): string | null {
    if (index < 0 || index >= CLIP_PAD_COUNT) return null;
    return shortPadLabel(this.clips[index]?.name ?? null);
  }

  /**
   * #281: パッド押下。切替は sync 接続有無で即時/クオンタイズが変わり、それを知るのは
   * evaluate だけなので、ここでは pending を立てるだけにする（未割当は no-op）。
   */
  playPad(index: number): void {
    if (!this.hasPad(index)) return;
    this.pending = index;
  }

  /**
   * #281: 毎フレーム（evaluate から）。sync 入力値と loop param を受け取り、
   * resolveLaunch で pending の即時切替/アーム保持/エッジ切替を確定する。
   * syncVal: undefined ⇒ sync 未接続、boolean ⇒ 接続済み（立ち上がりエッジ検出）。
   * 戻り値 switched は「実際に切替が起きたフレーム」のみ true（trigger 出力用）。
   */
  step(syncVal: unknown, loop: boolean): { switched: boolean } {
    const syncConnected = syncVal !== undefined;
    const sync = Boolean(syncVal);
    const syncEdge = sync && !this.prevSync;
    this.prevSync = sync;
    const r = resolveLaunch(this.pending, syncConnected, syncEdge);
    this.pending = r.armed;
    if (r.switchTo !== null) this.activate(r.switchTo);
    // loop は全 video 要素へ反映（アクティブだけだと切替時に反映漏れするため）。
    for (const clip of this.clips) {
      if (clip?.kind === "video") clip.video.loop = loop;
    }
    return { switched: r.switchTo !== null };
  }

  /** 切替を実行する（前のアクティブ video を pause・動画は頭から再生＝リトリガ）。 */
  private activate(index: number): void {
    const clip = this.clips[index];
    if (!clip) return;
    const prev = this.active !== null ? this.clips[this.active] : null;
    if (prev && prev !== clip && prev.kind === "video") prev.video.pause();
    this.active = index;
    if (clip.kind === "video") {
      try { clip.video.currentTime = 0; } catch { /* メタデータ未着はそのまま */ }
      void clip.video.play().catch(() => { /* 読込前の play は次の押下で再試行 */ });
    }
  }

  /** 現在再生中（texture 供給中）のパッド index（なしは null）。パッド強調表示用。 */
  activeIndex(): number | null {
    return this.active;
  }

  /** アーム（予約）中のパッド index（なしは null）。パッド点滅表示用。 */
  armedIndex(): number | null {
    return this.pending;
  }

  /** #281: パッド表示用（main.ts の padCellInfo 配線から呼ばれる duck-type）。 */
  padActive(index: number): boolean {
    return this.active === index;
  }

  padArmed(index: number): boolean {
    return this.pending === index;
  }

  /** #281: 全停止（Stop ボタン）。アクティブ video を pause し、アクティブ/アームを解除する。 */
  stopAll(): void {
    const cur = this.active !== null ? this.clips[this.active] : null;
    if (cur?.kind === "video") cur.video.pause();
    this.active = null;
    this.pending = null;
  }

  /** #281: 個別停止。そのパッドがアクティブなら停止、アーム中ならアーム解除。 */
  stopPad(index: number): void {
    if (this.pending === index) this.pending = null;
    if (this.active !== index) return;
    const clip = this.clips[index];
    if (clip?.kind === "video") clip.video.pause();
    this.active = null;
  }

  /** #281: 割当解除（objectURL revoke・要素破棄。アクティブ/アーム中なら解除）。padAssets は呼び出し側で消す。 */
  clearPad(index: number): void {
    if (index < 0 || index >= CLIP_PAD_COUNT) return;
    this.stopPad(index);
    const clip = this.clips[index];
    if (!clip) return;
    this.disposeClip(clip);
    this.clips[index] = null;
  }

  private disposeClip(clip: Clip): void {
    if (clip.kind === "video") {
      clip.video.pause();
      clip.video.remove();
    }
    this.deps.revokeObjectURL(clip.url);
  }

  /** アクティブクリップの texture（アクティブなし/未読込は null → 出力 undefined＝下流は黒）。 */
  getTexture(renderer: THREE.WebGLRenderer): THREE.Texture | null {
    const clip = this.active !== null ? this.clips[this.active] : null;
    if (!clip) return null;
    if (clip.kind === "video") {
      if (clip.video.videoWidth === 0) return null;
      return this.videoSurface.render(renderer, clip.video);
    }
    return this.imageSurface.render(renderer, clip.image);
  }

  /** ノード隣接プレビュー（アクティブクリップを contain 描画・VideoFileInput と同パターン）。 */
  previewFrame(): CanvasImageSource | null {
    const clip = this.active !== null ? this.clips[this.active] : null;
    if (!clip) return null;
    const srcW = clip.kind === "video" ? clip.video.videoWidth : clip.image.naturalWidth;
    const srcH = clip.kind === "video" ? clip.video.videoHeight : clip.image.naturalHeight;
    if (srcW === 0 || srcH === 0) return null;
    if (!this.previewCanvas) {
      this.previewCanvas = document.createElement("canvas");
      this.previewCanvas.width = PREVIEW_W;
      this.previewCanvas.height = PREVIEW_H;
    }
    const ctx = this.previewCanvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, PREVIEW_W, PREVIEW_H);
    const fit = containRect(srcW, srcH, PREVIEW_W, PREVIEW_H);
    ctx.drawImage(clip.kind === "video" ? clip.video : clip.image, fit.x, fit.y, fit.w, fit.h);
    return this.previewCanvas;
  }

  /** 全クリップ・surface の解放。 */
  dispose(): void {
    this.stopAll();
    for (let i = 0; i < CLIP_PAD_COUNT; i++) {
      const clip = this.clips[i];
      if (clip) this.disposeClip(clip);
      this.clips[i] = null;
    }
    this.videoSurface.dispose();
    this.imageSurface.dispose();
  }
}

/** #281: クリップランチャーノード。4×4 パッドの動画/画像クリップを texture として起動する。 */
export const ClipLauncherNode: NodeTypeDef = {
  type: "ClipLauncher",
  category: "source",
  description: "node.ClipLauncher.desc",
  isSink: false,
  padGrid: { rows: CLIP_PAD_ROWS, cols: CLIP_PAD_COLS, accept: "video/*,image/*" },
  inputs: [
    { id: "sync", label: "sync", type: "trigger", description: "node.ClipLauncher.port.sync" },
  ],
  outputs: [
    { id: "texture", label: "tex", type: "texture", description: "node.ClipLauncher.port.texture" },
    // 実際に切替が起きたフレームに 1 回発火（アーム時ではない）。Flash 等の演出同期用。
    { id: "trigger", label: "trig", type: "trigger", description: "node.ClipLauncher.port.trigger" },
  ],
  params: [
    { id: "loop", label: "loop", kind: "enum", default: "on", options: ["on", "off"],
      description: "node.ClipLauncher.param.loop" },
    // 各パッドの割当アセット id（string[]・長さ可変・hidden）。SamplePad と同名 param を使うことで
    // collectAssetRefs / main.ts のパッド復元がそのまま効く。
    { id: "padAssets", label: "padAssets", kind: "string", default: [], noInput: true, hidden: true,
      description: "node.ClipLauncher.param.padAssets" },
  ],
  createState: () => new ClipLauncherRuntime(),
  disposeState: (state: NodeState) => (state as ClipLauncherRuntime).dispose(),
  previewSource: (state: NodeState) => (state as ClipLauncherRuntime).previewFrame(),
  evaluate: (ctx) => {
    const s = ctx.state as ClipLauncherRuntime | undefined;
    if (!s) return { trigger: false };
    const { switched } = s.step(ctx.input("sync"), ctx.param("loop") !== "off");
    const texture = (ctx.env ? s.getTexture(ctx.env.renderer) : null) ?? undefined;
    return { texture, trigger: switched };
  },
};
