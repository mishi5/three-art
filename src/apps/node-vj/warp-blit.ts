// #282: コーナーピンワープ付きの全画面テクスチャ転写。
// TextureBlitter（graph/blit.ts）のワープ版: フルスクリーンクアッドを ShaderMaterial で描き、
// フラグメントシェーダが出力側の座標から逆 homography（uInvH）でソース UV を引く。
// [0,1] 外と同次座標 w<=0 は黒（前方写像より頑健）。テクスチャの v 反転（GL は y 上向き・
// ワープ座標系は y 下向き）はシェーダ内で吸収する。
// 注意: GLSL ソースは ASCII のみ（非 ASCII コメントはドライバによって silent fail する）。
import * as THREE from "three";
import type { Mat3 } from "./warp-logic";

export const WARP_VERTEX_SHADER = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const WARP_FRAGMENT_SHADER = /* glsl */ `
precision highp float;
uniform sampler2D uTex;
uniform mat3 uInvH;
varying vec2 vUv;
void main() {
  // display space: x right, y down, (0,0) = top-left. GL uv has y up, so flip v.
  vec2 p = vec2(vUv.x, 1.0 - vUv.y);
  vec3 s = uInvH * vec3(p, 1.0);
  if (s.z <= 0.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  vec2 q = s.xy / s.z;
  if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  gl_FragColor = texture2D(uTex, vec2(q.x, 1.0 - q.y));
}
`;

/**
 * ワープ転写。blit() で現在の renderTarget（null=default framebuffer）へ全画面描画する。
 * 呼び出し側（ScreenOutputs の dom deps）が drawImage で出力 canvas へコピーする。
 */
export class WarpBlitter {
  readonly uniforms = {
    uTex: { value: null as THREE.Texture | null },
    uInvH: { value: new THREE.Matrix3() },
  };
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private material: THREE.ShaderMaterial;
  private mesh: THREE.Mesh;

  constructor() {
    this.material = new THREE.ShaderMaterial({
      vertexShader: WARP_VERTEX_SHADER,
      fragmentShader: WARP_FRAGMENT_SHADER,
      uniforms: this.uniforms,
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }

  /** texture と逆 homography（row-major Mat3）を uniform へ反映する。 */
  setWarp(texture: THREE.Texture, invH: Mat3): void {
    this.uniforms.uTex.value = texture;
    // Matrix3.set は row-major 表記の引数を取り、内部 elements は column-major になる。
    this.uniforms.uInvH.value.set(
      invH[0]!, invH[1]!, invH[2]!,
      invH[3]!, invH[4]!, invH[5]!,
      invH[6]!, invH[7]!, invH[8]!,
    );
  }

  /** 現在の renderTarget へワープ付き全画面転写する（クリア込み・全画素を上書き）。 */
  blit(renderer: THREE.WebGLRenderer, texture: THREE.Texture, invH: Mat3): void {
    this.setWarp(texture, invH);
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.clear();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = prevAutoClear;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
