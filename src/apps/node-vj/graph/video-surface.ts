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

  /** video フレームを contain で RT に描いて texture を返す（映像未着は null）。 */
  render(renderer: THREE.WebGLRenderer, video: HTMLVideoElement): THREE.Texture | null {
    if (video.videoWidth === 0) return null;
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
