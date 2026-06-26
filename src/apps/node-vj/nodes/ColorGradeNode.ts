import * as THREE from "three";
import type { NodeState, NodeTypeDef } from "../graph/node-type";
import { ShaderSurface, NDC_VERTEX, blackTexture } from "../graph/shader-surface";
import { EFFECT_ENABLED_PARAM, isEffectEnabled, bypassOutput } from "./effect-bypass";

// Color / HSV grading (#191): hue rotate, saturation, brightness, contrast.
// ASCII-only GLSL source. rgb<->hsv via the standard branchless helpers.
const FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform float uHue;
uniform float uSat;
uniform float uBright;
uniform float uContrast;
vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}
vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}
void main() {
  vec3 c = texture2D(tDiffuse, vUv).rgb;
  vec3 hsv = rgb2hsv(c);
  hsv.x = fract(hsv.x + uHue);
  hsv.y = clamp(hsv.y * uSat, 0.0, 1.0);
  vec3 rgb = hsv2rgb(hsv) * uBright;
  rgb = (rgb - 0.5) * uContrast + 0.5;   // contrast around mid-grey
  gl_FragColor = vec4(clamp(rgb, 0.0, 1.0), 1.0);
}
`;

class ColorGradeState {
  readonly black = blackTexture();
  readonly material: THREE.ShaderMaterial;
  readonly surface: ShaderSurface;
  constructor() {
    this.material = new THREE.ShaderMaterial({
      vertexShader: NDC_VERTEX,
      fragmentShader: FRAG,
      uniforms: {
        tDiffuse: { value: this.black },
        uHue: { value: 0 },
        uSat: { value: 1 },
        uBright: { value: 1 },
        uContrast: { value: 1 },
      },
      depthTest: false, depthWrite: false,
    });
    this.surface = new ShaderSurface(this.material);
  }
  dispose(): void { this.surface.dispose(); this.black.dispose(); }
}

/** Color/HSV 調整（texture→texture）。色相回転・彩度・明度・コントラスト（#191）。 */
export const ColorGradeNode: NodeTypeDef = {
  type: "ColorGrade",
  category: "effect",
  description: "色相回転・彩度・明度・コントラストを調整するカラーコレクション。hueShift を Time/Sine で回すと色が巡回する。",
  isSink: true,
  inputs: [{ id: "in", label: "in", type: "texture", description: "色調整する元のテクスチャ。" }],
  outputs: [{ id: "texture", label: "tex", type: "texture", description: "色調整後のテクスチャ。" }],
  params: [
    EFFECT_ENABLED_PARAM,
    { id: "hueShift", label: "hueShift", kind: "number", default: 0, min: 0, max: 1, step: 0.01, description: "色相の回転量（0〜1 で一周）。" },
    { id: "saturation", label: "saturation", kind: "number", default: 1, min: 0, max: 2, step: 0.01, description: "彩度。0 でモノクロ、1 で原色維持、>1 で強調。" },
    { id: "brightness", label: "brightness", kind: "number", default: 1, min: 0, max: 2, step: 0.01, description: "明るさの倍率。" },
    { id: "contrast", label: "contrast", kind: "number", default: 1, min: 0, max: 2, step: 0.01, description: "コントラスト（中間グレー基準）。" },
  ],
  createState: () => new ColorGradeState(),
  disposeState: (state: NodeState) => (state as ColorGradeState).dispose(),
  evaluate(ctx) {
    const s = ctx.state as ColorGradeState | undefined;
    if (!s) return {};
    if (!isEffectEnabled(ctx.param)) return bypassOutput(ctx.input, s.black); // #134 無効時パススルー
    const env = ctx.env;
    if (!env) return {};
    const u = s.material.uniforms;
    u.tDiffuse!.value = (ctx.input("in") as THREE.Texture | undefined) ?? s.black;
    u.uHue!.value = Number(ctx.param("hueShift") ?? 0);
    u.uSat!.value = Number(ctx.param("saturation") ?? 1);
    u.uBright!.value = Number(ctx.param("brightness") ?? 1);
    u.uContrast!.value = Number(ctx.param("contrast") ?? 1);
    return { texture: s.surface.render(env.renderer) };
  },
};
