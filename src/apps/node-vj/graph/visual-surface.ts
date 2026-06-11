// Visual ノード共通の描画面（#76）。専用シーン + RenderTarget を持ち、
// evaluate 時に「自分のシーンを自分の RT に描いて texture を得る」を提供する。
import * as THREE from "three";

export class VisualSurface {
  readonly scene = new THREE.Scene();
  private rt: THREE.WebGLRenderTarget;

  constructor() {
    this.scene.background = new THREE.Color(0x000000);
    // サイズは初回 render 時に renderer に合わせて確定する
    this.rt = new THREE.WebGLRenderTarget(2, 2, { depthBuffer: true });
  }

  get texture(): THREE.Texture {
    return this.rt.texture;
  }

  /** renderer の drawing buffer サイズに RT を追従させてから、scene を RT へ描画する。 */
  render(renderer: THREE.WebGLRenderer, camera: THREE.Camera): THREE.Texture {
    const w = renderer.domElement.width;
    const h = renderer.domElement.height;
    if (this.rt.width !== w || this.rt.height !== h) this.rt.setSize(w, h);
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.rt);
    renderer.clear();
    renderer.render(this.scene, camera);
    renderer.setRenderTarget(prev);
    return this.rt.texture;
  }

  dispose(): void {
    this.rt.dispose();
  }
}
