import * as THREE from "three";
import type { NodeState, NodeTypeDef } from "../graph/node-type";
import { ShaderSurface, NDC_VERTEX, blackTexture } from "../graph/shader-surface";
import { EFFECT_ENABLED_PARAM, isEffectEnabled, bypassOutput } from "./effect-bypass";

// core/effects/FractalEffect の GLSL を移植。
const FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform float uIterations;
uniform float uScale;
uniform vec2 uCenter;
uniform float uRotation;
uniform float uFade;
uniform float uMix;
void main() {
  vec4 acc = vec4(0.0);
  float wsum = 0.0;
  vec2 c = 0.5 + uCenter;
  for (int i = 0; i < 6; i++) {
    if (float(i) >= uIterations) break;
    float k = pow(uScale, float(i));
    float rot = uRotation * float(i);
    float cs = cos(rot);
    float sn = sin(rot);
    vec2 d = vUv - c;
    vec2 r = vec2(d.x * cs - d.y * sn, d.x * sn + d.y * cs);
    vec2 q = r / max(0.0001, k) + c;
    float inside = step(0.0, q.x) * step(q.x, 1.0) * step(0.0, q.y) * step(q.y, 1.0);
    float depthFade = mix(1.0, 1.0 - float(i) / max(1.0, uIterations - 1.0), uFade);
    float w = depthFade * inside;
    acc += texture2D(tDiffuse, q) * w;
    wsum += w;
  }
  vec4 base = texture2D(tDiffuse, vUv);
  vec4 frac = (wsum > 0.0) ? acc / wsum : base;
  gl_FragColor = mix(base, frac, uMix);
}
`;

class FractalState {
  readonly black = blackTexture();
  readonly surface: ShaderSurface;
  constructor() {
    this.surface = new ShaderSurface(new THREE.ShaderMaterial({
      vertexShader: NDC_VERTEX,
      fragmentShader: FRAG,
      uniforms: {
        tDiffuse: { value: this.black },
        uIterations: { value: 3 },
        uScale: { value: 0.7 },
        uCenter: { value: new THREE.Vector2(0, 0) },
        uRotation: { value: 0 },
        uFade: { value: 0.3 },
        uMix: { value: 1 },
      },
      depthTest: false, depthWrite: false,
    }));
  }
  dispose(): void { this.surface.dispose(); this.black.dispose(); }
}

/** 再帰縮小コピー（texture→texture）。 */
export const FractalNode: NodeTypeDef = {
  type: "Fractal",
  category: "effect",
  description: "入力テクスチャを縮小・回転して再帰的に重ね、フラクタル状の入れ子模様を作るエフェクト。",
  isSink: true,
  inputs: [{ id: "in", label: "in", type: "texture", description: "再帰コピーする元のテクスチャ。" }],
  outputs: [{ id: "texture", label: "tex", type: "texture", description: "エフェクト適用後のテクスチャ。" }],
  params: [
    EFFECT_ENABLED_PARAM,
    { id: "iterations", label: "iterations", kind: "int", default: 3, min: 1, max: 6, step: 1, description: "再帰の重ね回数。" },
    { id: "scale", label: "scale", kind: "number", default: 0.7, min: 0.5, max: 0.95, step: 0.01, description: "1 段ごとの縮小率（小さいほど急に縮む）。" },
    { id: "rotation", label: "rotation", kind: "number", default: 0, min: -3.14, max: 3.14, step: 0.01, description: "1 段ごとの回転量（ラジアン）。" },
    { id: "fade", label: "fade", kind: "number", default: 0.3, min: 0, max: 1, step: 0.01, description: "深い段ほど暗くするフェード量。" },
    { id: "centerX", label: "centerX", kind: "number", default: 0, min: -0.5, max: 0.5, step: 0.01, description: "縮小中心の X オフセット（画面中央が 0）。" },
    { id: "centerY", label: "centerY", kind: "number", default: 0, min: -0.5, max: 0.5, step: 0.01, description: "縮小中心の Y オフセット（画面中央が 0）。" },
    { id: "mix", label: "mix", kind: "number", default: 1, min: 0, max: 1, step: 0.01, description: "効果の強さ。0 で元画像、1 でフラクタル（補間）。" },
  ],
  createState: () => new FractalState(),
  disposeState: (state: NodeState) => (state as FractalState).dispose(),
  evaluate(ctx) {
    const s = ctx.state as FractalState | undefined;
    if (!s) return {};
    if (!isEffectEnabled(ctx.param)) return bypassOutput(ctx.input, s.black); // #134 無効時パススルー
    const env = ctx.env;
    if (!env) return {};
    const u = s.surface.material.uniforms;
    u.tDiffuse!.value = (ctx.input("in") as THREE.Texture | undefined) ?? s.black;
    u.uIterations!.value = Math.max(1, Math.min(6, Math.round(Number(ctx.param("iterations") ?? 3))));
    u.uScale!.value = Number(ctx.param("scale") ?? 0.7);
    (u.uCenter!.value as THREE.Vector2).set(Number(ctx.param("centerX") ?? 0), Number(ctx.param("centerY") ?? 0));
    u.uRotation!.value = Number(ctx.param("rotation") ?? 0);
    u.uFade!.value = Number(ctx.param("fade") ?? 0.3);
    u.uMix!.value = Number(ctx.param("mix") ?? 1);
    return { texture: s.surface.render(env.renderer) };
  },
};
