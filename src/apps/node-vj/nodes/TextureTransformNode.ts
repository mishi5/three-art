import * as THREE from "three";
import type { NodeState, NodeTypeDef } from "../graph/node-type";
import { ShaderSurface, NDC_VERTEX, blackTexture } from "../graph/shader-surface";
import { EFFECT_ENABLED_PARAM, isEffectEnabled, bypassOutput } from "./effect-bypass";

// #138: 2D テクスチャ Transform（平行移動/拡縮/回転/反転 + wrap）。
// UV の逆変換式は texture-transform-logic.ts（transformUV/wrapCoord）と一致させること。
// 注意（threejs-art）: ASCII のみ / wrap・flip は float uniform で分岐（int 分岐を避ける）。
const FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform vec2 uOffset;
uniform vec2 uScale;
uniform float uRotation;
uniform vec2 uFlip;     // 0=off, 1=on
uniform float uWrap;    // 0=clamp, 1=repeat, 2=mirror, 3=none(透明)
uniform float uAspect;

float wrapC(float x, float m) {
  if (m < 0.5) return clamp(x, 0.0, 1.0);
  if (m < 1.5) return fract(x);
  if (m < 2.5) {
    float w = mod(abs(x), 2.0);
    return w > 1.0 ? 2.0 - w : w;
  }
  return x; // none: そのまま（範囲外は透明にする）
}

void main() {
  vec2 p = vUv - 0.5;
  p.x *= uAspect;
  float ca = cos(-uRotation);
  float sa = sin(-uRotation);
  p = mat2(ca, sa, -sa, ca) * p;   // 中心まわりの逆回転（aspect 補正つき）
  p.x /= uAspect;
  p /= uScale;
  if (uFlip.x > 0.5) p.x = -p.x;
  if (uFlip.y > 0.5) p.y = -p.y;
  vec2 suv = p + 0.5 - uOffset;
  // none(=3): 範囲外は描画しない（透明）。
  if (uWrap > 2.5 && (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0)) {
    gl_FragColor = vec4(0.0);
    return;
  }
  suv = vec2(wrapC(suv.x, uWrap), wrapC(suv.y, uWrap));
  gl_FragColor = texture2D(tDiffuse, suv);
}
`;

const WRAP_INT: Record<string, number> = { clamp: 0, repeat: 1, mirror: 2, none: 3 };

class TexTransformState {
  readonly black = blackTexture();
  readonly surface: ShaderSurface;
  constructor() {
    this.surface = new ShaderSurface(new THREE.ShaderMaterial({
      vertexShader: NDC_VERTEX,
      fragmentShader: FRAG,
      uniforms: {
        tDiffuse: { value: this.black },
        uOffset: { value: new THREE.Vector2(0, 0) },
        uScale: { value: new THREE.Vector2(1, 1) },
        uRotation: { value: 0 },
        uFlip: { value: new THREE.Vector2(0, 0) },
        uWrap: { value: 0 },
        uAspect: { value: 1 },
      },
      depthTest: false, depthWrite: false,
    }));
  }
  dispose(): void { this.surface.dispose(); this.black.dispose(); }
}

/** テクスチャ Transform（texture→texture）。2D 移動/拡縮/回転/反転を UV 変換で適用する（#138）。 */
export const TextureTransformNode: NodeTypeDef = {
  type: "TextureTransform",
  category: "effect",
  description: "入力テクスチャを 2D 変換（平行移動/拡大縮小/回転/反転）するエフェクト。はみ出しは wrap で処理。",
  isSink: true,
  inputs: [{ id: "in", label: "in", type: "texture", description: "変換する元のテクスチャ。" }],
  outputs: [{ id: "texture", label: "tex", type: "texture", description: "変換後のテクスチャ。" }],
  params: [
    EFFECT_ENABLED_PARAM,
    { id: "offsetX", label: "offsetX", kind: "number", default: 0, min: -1, max: 1, step: 0.01, description: "横方向の移動（UV 単位、+で右へ）。" },
    { id: "offsetY", label: "offsetY", kind: "number", default: 0, min: -1, max: 1, step: 0.01, description: "縦方向の移動（UV 単位、+で下へ）。" },
    { id: "scaleX", label: "scaleX", kind: "number", default: 1, min: 0.1, max: 4, step: 0.01, description: "横方向の拡大率（>1 でズームイン）。" },
    { id: "scaleY", label: "scaleY", kind: "number", default: 1, min: 0.1, max: 4, step: 0.01, description: "縦方向の拡大率（>1 でズームイン）。" },
    { id: "rotation", label: "rotation", kind: "number", default: 0, min: -3.14159, max: 3.14159, step: 0.01, description: "中心まわりの回転（ラジアン）。" },
    { id: "flipX", label: "flipX", kind: "enum", default: "off", options: ["off", "on"], description: "左右反転。" },
    { id: "flipY", label: "flipY", kind: "enum", default: "off", options: ["off", "on"], description: "上下反転。" },
    { id: "wrap", label: "wrap", kind: "enum", default: "none", options: ["none", "repeat", "mirror", "clamp"], description: "はみ出し時の処理（none=描画しない[透明] / repeat=タイル / mirror=鏡像 / clamp=端を引き伸ばし）。" },
  ],
  createState: () => new TexTransformState(),
  disposeState: (state: NodeState) => (state as TexTransformState).dispose(),
  evaluate(ctx) {
    const s = ctx.state as TexTransformState | undefined;
    if (!s) return {};
    if (!isEffectEnabled(ctx.param)) return bypassOutput(ctx.input, s.black); // #134 無効時パススルー
    const env = ctx.env;
    if (!env) return {};
    const u = s.surface.material.uniforms;
    u.tDiffuse!.value = (ctx.input("in") as THREE.Texture | undefined) ?? s.black;
    (u.uOffset!.value as THREE.Vector2).set(Number(ctx.param("offsetX") ?? 0), Number(ctx.param("offsetY") ?? 0));
    (u.uScale!.value as THREE.Vector2).set(
      Math.max(0.0001, Number(ctx.param("scaleX") ?? 1)),
      Math.max(0.0001, Number(ctx.param("scaleY") ?? 1)),
    );
    u.uRotation!.value = Number(ctx.param("rotation") ?? 0);
    (u.uFlip!.value as THREE.Vector2).set(
      ctx.param("flipX") === "on" ? 1 : 0,
      ctx.param("flipY") === "on" ? 1 : 0,
    );
    u.uWrap!.value = WRAP_INT[String(ctx.param("wrap") ?? "clamp")] ?? 0;
    u.uAspect!.value = env.renderer.domElement.width / Math.max(1, env.renderer.domElement.height);
    return { texture: s.surface.render(env.renderer) };
  },
};
