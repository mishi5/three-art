// 静止画（ImageFileInput）を renderer サイズの RT に contain（レターボックス）で描き、
// アスペクト比を保った texture として供給する（#219）。
// 素の画像 texture を直接流すと全面クアッドに引き伸ばされるため、入口で正規化する
// （VideoTextureSurface と同じ方針。VideoTexture でなく静止の THREE.Texture を使う）。
import * as THREE from "three";
import { containScale } from "../editor/fit";

export class ImageTextureSurface {
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private rt = new THREE.WebGLRenderTarget(2, 2, { depthBuffer: false });
  private texture: THREE.Texture | null = null;
  private sourceImage: HTMLImageElement | null = null;
  private material: THREE.MeshBasicMaterial;
  private mesh: THREE.Mesh;

  constructor() {
    this.scene.background = new THREE.Color(0x000000);
    this.material = new THREE.MeshBasicMaterial({ depthTest: false, depthWrite: false });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.scene.add(this.mesh);
  }

  /** 画像を contain で RT に描いて texture を返す（未読込/サイズ0 は null）。 */
  render(renderer: THREE.WebGLRenderer, image: HTMLImageElement): THREE.Texture | null {
    const srcW = image.naturalWidth;
    const srcH = image.naturalHeight;
    if (srcW === 0 || srcH === 0) return null;
    // 画像要素が変わったときのみ texture を作り直す（静止画は毎フレーム更新不要）。
    if (this.sourceImage !== image) {
      this.texture?.dispose();
      this.texture = new THREE.Texture(image);
      this.texture.colorSpace = THREE.SRGBColorSpace;
      this.texture.minFilter = THREE.LinearFilter;
      this.texture.magFilter = THREE.LinearFilter;
      this.texture.needsUpdate = true;
      this.material.map = this.texture;
      this.material.needsUpdate = true;
      this.sourceImage = image;
    }
    const w = renderer.domElement.width;
    const h = renderer.domElement.height;
    if (this.rt.width !== w || this.rt.height !== h) this.rt.setSize(w, h);
    // NDC 全面 (2x2) に対する contain スケール（黒帯は scene.background）
    const s = containScale(srcW, srcH, w, h);
    this.mesh.scale.set(s.x, s.y, 1);
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.rt);
    renderer.clear();
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(prev);
    return this.rt.texture;
  }

  dispose(): void {
    this.rt.dispose();
    this.texture?.dispose();
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
