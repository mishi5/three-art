// video（カメラ/動画ファイル）を renderer サイズの RT に contain（レターボックス）で
// 描き、アスペクト比を保った texture として供給する（#66）。
// 生の VideoTexture を直接流すと全面クアッドに引き伸ばされるため、入口で正規化する。
import * as THREE from "three";
import { containScale } from "../editor/fit";

export class VideoTextureSurface {
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private rt = new THREE.WebGLRenderTarget(2, 2, { depthBuffer: false });
  private videoTexture: THREE.VideoTexture | null = null;
  private material: THREE.MeshBasicMaterial;
  private mesh: THREE.Mesh;

  constructor() {
    this.scene.background = new THREE.Color(0x000000);
    this.material = new THREE.MeshBasicMaterial({ depthTest: false, depthWrite: false });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.scene.add(this.mesh);
  }

  /**
   * #241: フェード量を設定する（0=黒、1=そのまま）。MeshBasicMaterial.color は map と
   * 乗算されるため、(f,f,f) を掛けると輝度乗算＝黒フェードになる。
   * 範囲外は 0..1 にクランプ、NaN 等の不正値は 1（従来描画）に落とす。
   */
  setFade(fade: number): void {
    const f = Number.isFinite(fade) ? Math.min(1, Math.max(0, fade)) : 1;
    this.material.color.setScalar(f);
  }

  /**
   * video フレームを contain で RT に描いて texture を返す（映像未着は null）。
   * fade は #241 の黒フェード量（省略時 1=従来と同一。CameraInput/DisplayInput 共用のため）。
   */
  render(renderer: THREE.WebGLRenderer, video: HTMLVideoElement, fade = 1): THREE.Texture | null {
    if (video.videoWidth === 0) return null;
    this.setFade(fade);
    if (!this.videoTexture) {
      this.videoTexture = new THREE.VideoTexture(video);
      this.material.map = this.videoTexture;
      this.material.needsUpdate = true;
    }
    const w = renderer.domElement.width;
    const h = renderer.domElement.height;
    if (this.rt.width !== w || this.rt.height !== h) this.rt.setSize(w, h);
    // NDC 全面 (2x2) に対する contain スケール（黒帯は scene.background）
    const s = containScale(video.videoWidth, video.videoHeight, w, h);
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
    this.videoTexture?.dispose();
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
