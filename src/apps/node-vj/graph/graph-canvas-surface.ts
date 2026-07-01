// Canvas2D で折れ線グラフ（波形）を描き、THREE.CanvasTexture 経由で RT へ転写して
// texture 出力する共通ヘルパ（#217）。VideoTextureSurface と同方式で、CanvasTexture の
// flipY(=true) を全画面クアッド描画で吸収し、下流（RT texture・flipY=false）と向きを揃える。
import * as THREE from "three";

export class GraphCanvasSurface {
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private rt = new THREE.WebGLRenderTarget(2, 2, { depthBuffer: false });
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private texture: THREE.CanvasTexture;
  private material: THREE.MeshBasicMaterial;
  private mesh: THREE.Mesh;

  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.width = 2;
    this.canvas.height = 2;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("GraphCanvasSurface: 2D context を取得できません");
    this.ctx = ctx;
    this.texture = new THREE.CanvasTexture(this.canvas);
    // bgAlpha<1 の背景を下流（Blend 等）へ透過させるため transparent。
    this.material = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.scene.add(this.mesh);
  }

  /** 描画先 Canvas2D コンテキスト（呼び出し側が折れ線を描く）。 */
  get context2d(): CanvasRenderingContext2D {
    return this.ctx;
  }

  /** キャンバス（＝RT）サイズを描画解像度へ合わせる。 */
  resize(width: number, height: number): void {
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      // CanvasTexture は canvas リサイズで GPU テクスチャを再確保しない。大きくなった canvas を
      // 小さいテクスチャへ sub-upload すると overflow（glCopySubTextureCHROMIUM: Offset overflows
      // texture dimensions）して以後アップロードが止まり固まる。サイズ変更時は作り直す。
      this.texture.dispose();
      this.texture = new THREE.CanvasTexture(this.canvas);
      this.material.map = this.texture;
      this.material.needsUpdate = true;
    }
    if (this.rt.width !== w || this.rt.height !== h) this.rt.setSize(w, h);
  }

  /** 現在のキャンバス幅（px）。 */
  get width(): number {
    return this.canvas.width;
  }

  /** 現在のキャンバス高さ（px）。 */
  get height(): number {
    return this.canvas.height;
  }

  /** 描き終えたキャンバスを RT へ転写し、結果 texture を返す。 */
  commit(renderer: THREE.WebGLRenderer): THREE.Texture {
    this.texture.needsUpdate = true;
    const prevRT = renderer.getRenderTarget();
    const prevColor = renderer.getClearColor(new THREE.Color());
    const prevAlpha = renderer.getClearAlpha();
    renderer.setRenderTarget(this.rt);
    // アルファ 0 でクリアし、キャンバスの透明部分を維持する。
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(this.scene, this.camera);
    // 他ノードの描画に影響しないよう renderer の clear 状態を復元。
    renderer.setClearColor(prevColor, prevAlpha);
    renderer.setRenderTarget(prevRT);
    return this.rt.texture;
  }

  dispose(): void {
    this.rt.dispose();
    this.texture.dispose();
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
