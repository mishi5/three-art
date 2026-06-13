// 全画面クアッド＋ShaderMaterial を専用 RT へ描画する共通ヘルパ（#64）。
// Blend（#85）と同方式。texture→texture のエフェクトノードが使う。
import * as THREE from "three";

export const NDC_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export class ShaderSurface {
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private rt = new THREE.WebGLRenderTarget(2, 2, { depthBuffer: false });
  private mesh: THREE.Mesh;

  constructor(readonly material: THREE.ShaderMaterial) {
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    this.scene.add(this.mesh);
  }

  /** renderer サイズに RT を追従させてから描画し、結果 texture を返す。 */
  render(renderer: THREE.WebGLRenderer): THREE.Texture {
    const w = renderer.domElement.width;
    const h = renderer.domElement.height;
    if (this.rt.width !== w || this.rt.height !== h) this.rt.setSize(w, h);
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.rt);
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(prev);
    return this.rt.texture;
  }

  dispose(): void {
    this.rt.dispose();
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

/** 1x1 黒テクスチャ（未接続入力のフォールバック）。 */
export function blackTexture(): THREE.Texture {
  const tex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  tex.needsUpdate = true;
  return tex;
}
