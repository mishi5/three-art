import * as THREE from "three";
import type { NodeState, NodeTypeDef } from "../graph/node-type";
import { ShaderSurface, NDC_VERTEX, blackTexture } from "../graph/shader-surface";
import { EFFECT_ENABLED_PARAM, isEffectEnabled, bypassOutput } from "./effect-bypass";

// core/effects/BlurEffect の gaussian カーネルを移植（h/v 2 パス）。
const FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform vec2 uTexel;
uniform vec2 uDirection;
uniform float uRadius;
void main() {
  vec2 stepv = uTexel * uDirection * uRadius;
  vec4 c = texture2D(tDiffuse, vUv) * 0.227027;
  c += texture2D(tDiffuse, vUv + stepv * 1.0) * 0.194595;
  c += texture2D(tDiffuse, vUv - stepv * 1.0) * 0.194595;
  c += texture2D(tDiffuse, vUv + stepv * 2.0) * 0.121622;
  c += texture2D(tDiffuse, vUv - stepv * 2.0) * 0.121622;
  c += texture2D(tDiffuse, vUv + stepv * 3.0) * 0.054054;
  c += texture2D(tDiffuse, vUv - stepv * 3.0) * 0.054054;
  c += texture2D(tDiffuse, vUv + stepv * 4.0) * 0.016216;
  c += texture2D(tDiffuse, vUv - stepv * 4.0) * 0.016216;
  gl_FragColor = c;
}
`;

class BlurState {
  readonly black = blackTexture();
  readonly material: THREE.ShaderMaterial;
  readonly passH: ShaderSurface;
  readonly passV: ShaderSurface;

  constructor() {
    this.material = new THREE.ShaderMaterial({
      vertexShader: NDC_VERTEX,
      fragmentShader: FRAG,
      uniforms: {
        tDiffuse: { value: this.black },
        uTexel: { value: new THREE.Vector2(1 / 2, 1 / 2) },
        uDirection: { value: new THREE.Vector2(1, 0) },
        uRadius: { value: 0 },
      },
      depthTest: false, depthWrite: false,
    });
    // 同一 material を共有し、uniforms を切り替えて 2 回描画する
    this.passH = new ShaderSurface(this.material);
    this.passV = new ShaderSurface(this.material);
  }

  dispose(): void {
    this.passH.dispose();
    this.passV.dispose(); // material は共有のため二重 dispose になるが three 側で安全
    this.black.dispose();
  }
}

/** ガウスぼかし（texture→texture）。strength<=0 は入力をそのまま通す。 */
export const BlurNode: NodeTypeDef = {
  type: "Blur",
  category: "effect",
  description: "入力テクスチャにガウスぼかしをかける（水平・垂直の 2 パス）。strength<=0 はパススルー。",
  isSink: true,
  inputs: [{ id: "in", label: "in", type: "texture", description: "ぼかす元のテクスチャ。" }],
  outputs: [{ id: "texture", label: "tex", type: "texture", description: "ぼかし後のテクスチャ。" }],
  params: [
    EFFECT_ENABLED_PARAM,
    { id: "strength", label: "strength", kind: "number", default: 4, min: 0, max: 20, step: 0.1, description: "ぼかしの強さ（カーネル半径）。0 以下で無効化（コストゼロ）。" },
  ],
  createState: () => new BlurState(),
  disposeState: (state: NodeState) => (state as BlurState).dispose(),
  evaluate(ctx) {
    const s = ctx.state as BlurState | undefined;
    if (!s) return {};
    if (!isEffectEnabled(ctx.param)) return bypassOutput(ctx.input, s.black); // #134 無効時パススルー
    const env = ctx.env;
    if (!env) return {};
    const input = (ctx.input("in") as THREE.Texture | undefined) ?? s.black;
    const strength = Number(ctx.param("strength") ?? 0);
    if (strength <= 0) return { texture: input }; // パススルー（コストゼロ）
    const u = s.material.uniforms;
    const w = env.renderer.domElement.width;
    const h = env.renderer.domElement.height;
    (u.uTexel!.value as THREE.Vector2).set(1 / Math.max(1, w), 1 / Math.max(1, h));
    u.uRadius!.value = strength;
    // pass1: 水平
    u.tDiffuse!.value = input;
    (u.uDirection!.value as THREE.Vector2).set(1, 0);
    const mid = s.passH.render(env.renderer);
    // pass2: 垂直
    u.tDiffuse!.value = mid;
    (u.uDirection!.value as THREE.Vector2).set(0, 1);
    const texture = s.passV.render(env.renderer);
    return { texture };
  },
};
