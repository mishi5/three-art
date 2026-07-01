import * as THREE from "three";
import type { NodeState, NodeTypeDef } from "../graph/node-type";
import { PREVIEW_W, PREVIEW_H } from "../graph/preview";
import { containRect } from "../editor/fit";
import { ImageTextureSurface } from "../graph/image-surface";

/**
 * ImageFileInput ノードの永続状態（#121）。静止画ファイルを読み込んで texture を供給する。
 * ファイル選択（user gesture）から loadFile を呼ぶ。音声は持たない（VideoFileInput の簡易版）。
 * #219: 素の画像 texture は下流の全画面描画で出力アスペクトに引き伸ばされるため、
 * ImageTextureSurface で画面サイズ RT へ contain 描画し、アスペクト比を入口で正規化して出力する
 * （VideoFileInput と挙動を揃える）。
 */
export class ImageFileInputRuntime {
  private img: HTMLImageElement | null = null;
  private surface = new ImageTextureSurface();
  private objectUrl: string | null = null;
  private previewCanvas: HTMLCanvasElement | null = null;
  /** #99: ノード上に表示する現在のファイル名（未選択は null）。 */
  fileName: string | null = null;

  /** 画像ファイルを読み込んでテクスチャ化する（user gesture から）。 */
  async loadFile(file: File): Promise<void> {
    this.fileName = file.name;
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = URL.createObjectURL(file);
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error(`failed to load image: ${file.name}`));
      img.src = this.objectUrl!;
    });
    this.img = img;
  }

  /** 画面サイズ RT へ contain 描画した texture（アスペクト比の入口正規化。未読込なら null）。 */
  getTexture(renderer: THREE.WebGLRenderer): THREE.Texture | null {
    if (!this.img) return null;
    return this.surface.render(renderer, this.img);
  }

  previewFrame(): CanvasImageSource | null {
    if (!this.img) return null;
    if (!this.previewCanvas) {
      this.previewCanvas = document.createElement("canvas");
      this.previewCanvas.width = PREVIEW_W;
      this.previewCanvas.height = PREVIEW_H;
    }
    const ctx = this.previewCanvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, PREVIEW_W, PREVIEW_H);
    const fit = containRect(this.img.naturalWidth, this.img.naturalHeight, PREVIEW_W, PREVIEW_H);
    ctx.drawImage(this.img, fit.x, fit.y, fit.w, fit.h);
    return this.previewCanvas;
  }

  dispose(): void {
    this.surface.dispose();
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.img = null;
  }
}

/** 静止画ファイル入力ノード（#121）。画像ファイルを読み込んで texture を出力する。 */
export const ImageFileInputNode: NodeTypeDef = {
  type: "ImageFileInput",
  category: "input",
  description: "静止画ファイルを読み込んで texture を出力するノード。PointShape の image モードや任意の texture 入力に繋ぐ。",
  isSink: false,
  fileInput: { accept: "image/*" },
  inputs: [],
  outputs: [
    { id: "texture", label: "tex", type: "texture", description: "読み込んだ画像のテクスチャ（アスペクト比を入口で正規化済み）。" },
  ],
  params: [
    { id: "assetId", label: "asset", kind: "string", default: "", noInput: true, hidden: true,
      description: "割り当てられたアセットの id（アセットライブラリ管理・UI 非表示）。" },
  ],
  createState: () => new ImageFileInputRuntime(),
  disposeState: (state: NodeState) => (state as ImageFileInputRuntime).dispose(),
  previewSource: (state: NodeState) => (state as ImageFileInputRuntime).previewFrame(),
  evaluate: (ctx) => {
    const s = ctx.state as ImageFileInputRuntime | undefined;
    if (!s) return {};
    const texture = (ctx.env ? s.getTexture(ctx.env.renderer) : null) ?? undefined;
    return { texture };
  },
};
