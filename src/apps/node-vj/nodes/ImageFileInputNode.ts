import * as THREE from "three";
import type { NodeState, NodeTypeDef } from "../graph/node-type";
import { PREVIEW_W, PREVIEW_H } from "../graph/preview";
import { containRect } from "../editor/fit";

/**
 * ImageFileInput ノードの永続状態（#121）。静止画ファイルを読み込んで texture を供給する。
 * ファイル選択（user gesture）から loadFile を呼ぶ。音声は持たない（VideoFileInput の簡易版）。
 * 出力は素の画像テクスチャ（アスペクト比は下流の PointShape image モード等が image.width/height から扱う）。
 */
export class ImageFileInputRuntime {
  private img: HTMLImageElement | null = null;
  private tex: THREE.Texture | null = null;
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
    if (this.tex) this.tex.dispose();
    this.tex = new THREE.Texture(img);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.minFilter = THREE.LinearFilter;
    this.tex.magFilter = THREE.LinearFilter;
    this.tex.needsUpdate = true;
  }

  /** 読み込み済みの画像テクスチャ（未読込なら null）。 */
  getTexture(): THREE.Texture | null {
    return this.tex;
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
    if (this.tex) this.tex.dispose();
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.img = null;
    this.tex = null;
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
    { id: "texture", label: "tex", type: "texture", description: "読み込んだ画像のテクスチャ（素の画像。アスペクト比は下流で扱う）。" },
  ],
  params: [
    { id: "assetId", label: "asset", kind: "string", default: "", noInput: true,
      description: "割り当てられたアセットの id（アセットライブラリ管理・UI 非表示）。" },
  ],
  createState: () => new ImageFileInputRuntime(),
  disposeState: (state: NodeState) => (state as ImageFileInputRuntime).dispose(),
  previewSource: (state: NodeState) => (state as ImageFileInputRuntime).previewFrame(),
  evaluate: (ctx) => {
    const s = ctx.state as ImageFileInputRuntime | undefined;
    if (!s) return {};
    const texture = s.getTexture() ?? undefined;
    return { texture };
  },
};
