// #101: GPGPU の 1 パス（フルスクリーン quad → float RenderTarget）。
// 形状生成 / Transform の各段が 1 つ保持し、位置テクスチャ（RGBA32F）を書き出す。
// GPUComputationRenderer はピンポン用で重いため、feed-forward チェーン向けに軽量化した自前実装。
import * as THREE from "three";

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

/**
 * フラグメントシェーダで位置テクスチャ 1 枚を生成/変換するパス。
 * uniforms は呼び出し側が保持・更新する（render 前に書き換える）。
 */
export class PositionFieldPass {
  private rt: THREE.WebGLRenderTarget;
  private scene = new THREE.Scene();
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private material: THREE.ShaderMaterial;
  private mesh: THREE.Mesh;

  constructor(fragmentShader: string, uniforms: Record<string, THREE.IUniform>, w = 1, h = 1) {
    this.rt = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.FloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: false,
      stencilBuffer: false,
    });
    this.material = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader, uniforms });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.scene.add(this.mesh);
  }

  get uniforms(): Record<string, THREE.IUniform> {
    return this.material.uniforms;
  }

  get texture(): THREE.Texture {
    return this.rt.texture;
  }

  setSize(w: number, h: number): void {
    if (this.rt.width !== w || this.rt.height !== h) this.rt.setSize(w, h);
  }

  /** 現在の uniforms で 1 パス実行し、位置テクスチャを返す。 */
  render(renderer: THREE.WebGLRenderer): THREE.Texture {
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.rt);
    renderer.render(this.scene, this.cam);
    renderer.setRenderTarget(prev);
    return this.rt.texture;
  }

  dispose(): void {
    this.rt.dispose();
    this.material.dispose();
    this.mesh.geometry.dispose();
  }
}
