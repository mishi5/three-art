import * as THREE from "three";
import type { NodeState, NodeTypeDef } from "../graph/node-type";
import { ShaderSurface, NDC_VERTEX, blackTexture } from "../graph/shader-surface";
import { EFFECT_ENABLED_PARAM, isEffectEnabled, bypassOutput } from "./effect-bypass";

type DistortMode = "fisheye" | "twist" | "wave";
const MODE_INT: Record<DistortMode, number> = { fisheye: 0, twist: 1, wave: 2 };

/** mode 文字列を shader 用の int に。未知は 0（fisheye）。 */
export function distortModeInt(mode: string): number {
  return MODE_INT[mode as DistortMode] ?? 0;
}

// UV を変形して再サンプルする歪みエフェクト。ASCII のみ。
// fisheye: amount 符号で 魚眼(>0=中心を拡大) / 逆歪み(<0=ピンクッション)。radius 内で減衰。
// twist: 中心まわりの渦巻き（距離で減衰）。wave: 正弦波の UV リップル。
const FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform float uMode;
uniform float uAmount;
uniform vec2 uCenter;
uniform float uRadius;
uniform float uMix;
uniform float uAspect;
void main() {
  vec2 c = vec2(0.5) + uCenter;
  vec2 p = vUv - c;
  p.x *= uAspect;                          // アスペクト補正した中心からのベクトル
  float r = length(p);
  float rn = clamp(r / max(0.0001, uRadius), 0.0, 1.0);
  vec2 uv = vUv;
  if (uMode < 0.5) {
    // fisheye / pinch: 半径方向にスケール（中心ほど強く、radius 外は恒等）
    float f = 1.0 + uAmount * (1.0 - rn);
    vec2 dir = p / max(1e-4, r);
    vec2 np = dir * (r * f);
    np.x /= uAspect;
    uv = c + np;
  } else if (uMode < 1.5) {
    // twist: 距離で減衰する回転
    float ang = uAmount * 6.2831853 * (1.0 - smoothstep(0.0, 1.0, rn));
    float ca = cos(ang), sa = sin(ang);
    vec2 rp = vec2(ca * p.x - sa * p.y, sa * p.x + ca * p.y);
    rp.x /= uAspect;
    uv = c + rp;
  } else {
    // wave: 正弦波 UV リップル（radius で波長を制御）
    float freq = 6.2831853 / max(0.02, uRadius);
    uv += uAmount * 0.05 * vec2(sin(vUv.y * freq), sin(vUv.x * freq + 1.7));
  }
  vec4 src = texture2D(tDiffuse, vUv);
  vec4 dst = texture2D(tDiffuse, clamp(uv, 0.0, 1.0));
  gl_FragColor = mix(src, dst, uMix);
}
`;

class DistortState {
  readonly black = blackTexture();
  readonly surface: ShaderSurface;
  constructor() {
    this.surface = new ShaderSurface(new THREE.ShaderMaterial({
      vertexShader: NDC_VERTEX,
      fragmentShader: FRAG,
      uniforms: {
        tDiffuse: { value: this.black },
        uMode: { value: 0 },
        uAmount: { value: 0.5 },
        uCenter: { value: new THREE.Vector2(0, 0) },
        uRadius: { value: 0.5 },
        uMix: { value: 1 },
        uAspect: { value: 1 },
      },
      depthTest: false, depthWrite: false,
    }));
  }
  dispose(): void { this.surface.dispose(); this.black.dispose(); }
}

/** 歪みエフェクト（texture→texture）。魚眼/逆歪み・ねじれ・波の UV 変形（#149）。 */
export const DistortNode: NodeTypeDef = {
  type: "Distort",
  category: "effect",
  description: "入力テクスチャの UV を変形する歪みエフェクト。fisheye(魚眼/逆歪み)・twist(ねじれ)・wave(波)。",
  isSink: true,
  inputs: [{ id: "in", label: "in", type: "texture", description: "歪ませる元のテクスチャ。" }],
  outputs: [{ id: "texture", label: "tex", type: "texture", description: "歪み適用後のテクスチャ。" }],
  params: [
    EFFECT_ENABLED_PARAM,
    { id: "mode", label: "mode", kind: "enum", default: "fisheye", options: ["fisheye", "twist", "wave"], description: "歪みの種類。fisheye=魚眼(amount>0)/逆歪み(amount<0) / twist=ねじれ / wave=波。" },
    { id: "amount", label: "amount", kind: "number", default: 0.5, min: -1, max: 1, step: 0.01, description: "歪み量。fisheye は正=魚眼/負=逆歪み。" },
    { id: "centerX", label: "centerX", kind: "number", default: 0, min: -0.5, max: 0.5, step: 0.01, description: "中心の X オフセット（画面中央が 0）。" },
    { id: "centerY", label: "centerY", kind: "number", default: 0, min: -0.5, max: 0.5, step: 0.01, description: "中心の Y オフセット（画面中央が 0）。" },
    { id: "radius", label: "radius", kind: "number", default: 0.5, min: 0.05, max: 1.5, step: 0.01, description: "効果の半径（fisheye/twist の及ぶ範囲 / wave の波長）。" },
    { id: "mix", label: "mix", kind: "number", default: 1, min: 0, max: 1, step: 0.01, description: "効果の強さ。0 で元画像、1 で歪み（補間）。" },
  ],
  createState: () => new DistortState(),
  disposeState: (state: NodeState) => (state as DistortState).dispose(),
  evaluate(ctx) {
    const s = ctx.state as DistortState | undefined;
    if (!s) return {};
    if (!isEffectEnabled(ctx.param)) return bypassOutput(ctx.input, s.black);  // #134 無効時パススルー
    const env = ctx.env;
    if (!env) return {};
    const u = s.surface.material.uniforms;
    u.tDiffuse!.value = (ctx.input("in") as THREE.Texture | undefined) ?? s.black;
    u.uMode!.value = distortModeInt(String(ctx.param("mode") ?? "fisheye"));
    u.uAmount!.value = Number(ctx.param("amount") ?? 0.5);
    (u.uCenter!.value as THREE.Vector2).set(Number(ctx.param("centerX") ?? 0), Number(ctx.param("centerY") ?? 0));
    u.uRadius!.value = Number(ctx.param("radius") ?? 0.5);
    u.uMix!.value = Number(ctx.param("mix") ?? 1);
    u.uAspect!.value = env.renderer.domElement.width / Math.max(1, env.renderer.domElement.height);
    return { texture: s.surface.render(env.renderer) };
  },
};
