import * as THREE from "three";
import type { NodeState, NodeTypeDef } from "../graph/node-type";
import { NDC_VERTEX, blackTexture } from "../graph/shader-surface";
import { EFFECT_ENABLED_PARAM, isEffectEnabled, bypassOutput } from "./effect-bypass";

const DEG = Math.PI / 180;

// 前フレーム出力を変形・減衰して現フレームに重ねる（残像/無限トンネル）。ASCII のみ。
// tPrev を scale/rotate/offset した UV でサンプルし、decay を掛けて現フレームと max 合成。
const FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tCurrent;
uniform sampler2D tPrev;
uniform float uDecay;
uniform vec2 uOffset;
uniform float uScale;
uniform float uRotate;
uniform float uAspect;
void main() {
  vec2 p = vUv - 0.5;
  p.x *= uAspect;
  float ca = cos(uRotate), sa = sin(uRotate);
  // 画像を scale 倍に見せるには 1/scale の位置をサンプルする（中心まわりに回転も逆回し）
  vec2 rp = vec2(ca * p.x + sa * p.y, -sa * p.x + ca * p.y) / max(0.01, uScale);
  rp.x /= uAspect;
  vec2 prevUv = rp + 0.5 - uOffset;
  vec4 prev = texture2D(tPrev, prevUv);
  vec4 cur = texture2D(tCurrent, vUv);
  // 残像: 現フレームと「減衰させた前フレーム」を max 合成（飽和せず安定）
  vec3 col = max(cur.rgb, prev.rgb * uDecay);
  gl_FragColor = vec4(col, 1.0);
}
`;

/** ピンポン 2 RT で前フレームを保持するフィードバック state。 */
class FeedbackState {
  readonly black = blackTexture();
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  readonly material: THREE.ShaderMaterial;
  private rtA = new THREE.WebGLRenderTarget(2, 2, { depthBuffer: false });
  private rtB = new THREE.WebGLRenderTarget(2, 2, { depthBuffer: false });
  private mesh: THREE.Mesh;

  constructor() {
    this.material = new THREE.ShaderMaterial({
      vertexShader: NDC_VERTEX,
      fragmentShader: FRAG,
      uniforms: {
        tCurrent: { value: this.black },
        tPrev: { value: this.black },
        uDecay: { value: 0.9 },
        uOffset: { value: new THREE.Vector2(0, 0) },
        uScale: { value: 1 },
        uRotate: { value: 0 },
        uAspect: { value: 1 },
      },
      depthTest: false, depthWrite: false,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.scene.add(this.mesh);
  }

  /** 現フレーム入力と前フレームを合成して書き込み、結果 texture を返す（read/write をスワップ）。 */
  render(renderer: THREE.WebGLRenderer, current: THREE.Texture): THREE.Texture {
    const w = renderer.domElement.width;
    const h = renderer.domElement.height;
    if (this.rtA.width !== w || this.rtA.height !== h) {
      this.rtA.setSize(w, h);
      this.rtB.setSize(w, h);
    }
    const u = this.material.uniforms;
    u.tCurrent!.value = current;
    u.tPrev!.value = this.rtA.texture;     // 前フレーム出力
    const prevRT = renderer.getRenderTarget();
    renderer.setRenderTarget(this.rtB);    // 書き込み先
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(prevRT);
    const out = this.rtB.texture;
    const tmp = this.rtA; this.rtA = this.rtB; this.rtB = tmp;  // スワップ（次フレームの prev = 今書いた結果）
    return out;
  }

  dispose(): void {
    this.rtA.dispose();
    this.rtB.dispose();
    this.material.dispose();
    this.mesh.geometry.dispose();
    this.black.dispose();
  }
}

/** フレームフィードバック/ディレイ（texture→texture）。前フレームを変形・減衰して重ねる（#156）。 */
export const FeedbackNode: NodeTypeDef = {
  type: "Feedback",
  category: "effect",
  description: "前フレームの出力を減衰・オフセット・スケール・回転して現フレームに重ねる。残像/無限トンネル系。",
  isSink: true,
  inputs: [{ id: "in", label: "in", type: "texture", description: "現フレームの入力テクスチャ。" }],
  outputs: [{ id: "texture", label: "tex", type: "texture", description: "フィードバック合成後のテクスチャ。" }],
  params: [
    EFFECT_ENABLED_PARAM,
    { id: "decay", label: "decay", kind: "number", default: 0.9, min: 0, max: 1, step: 0.01, description: "前フレームの残存度（1 に近いほど長く残る）。" },
    { id: "offsetX", label: "offsetX", kind: "number", default: 0, min: -0.2, max: 0.2, step: 0.005, description: "前フレームの X 方向オフセット（流れる方向）。" },
    { id: "offsetY", label: "offsetY", kind: "number", default: 0, min: -0.2, max: 0.2, step: 0.005, description: "前フレームの Y 方向オフセット。" },
    { id: "scale", label: "scale", kind: "number", default: 1, min: 0.9, max: 1.1, step: 0.001, description: "前フレームの拡大率（>1 で無限トンネル、<1 で収束）。" },
    { id: "rotate", label: "rotate", kind: "number", default: 0, min: -30, max: 30, step: 0.1, description: "前フレームの回転（度/フレーム）。スパイラル残像。" },
  ],
  createState: () => new FeedbackState(),
  disposeState: (state: NodeState) => (state as FeedbackState).dispose(),
  evaluate(ctx) {
    const s = ctx.state as FeedbackState | undefined;
    if (!s) return {};
    if (!isEffectEnabled(ctx.param)) return bypassOutput(ctx.input, s.black);  // #134 無効時パススルー
    const env = ctx.env;
    if (!env) return {};
    const u = s.material.uniforms;
    u.uDecay!.value = Number(ctx.param("decay") ?? 0.9);
    (u.uOffset!.value as THREE.Vector2).set(Number(ctx.param("offsetX") ?? 0), Number(ctx.param("offsetY") ?? 0));
    u.uScale!.value = Number(ctx.param("scale") ?? 1);
    u.uRotate!.value = Number(ctx.param("rotate") ?? 0) * DEG;
    u.uAspect!.value = env.renderer.domElement.width / Math.max(1, env.renderer.domElement.height);
    const current = (ctx.input("in") as THREE.Texture | undefined) ?? s.black;
    return { texture: s.render(env.renderer, current) };
  },
};
