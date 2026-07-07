import * as THREE from "three";
import type { NodeState, NodeTypeDef } from "../graph/node-type";
import { ShaderSurface, NDC_VERTEX, blackTexture } from "../graph/shader-surface";
import { EFFECT_ENABLED_PARAM, isEffectEnabled, bypassOutput } from "./effect-bypass";

// CRT / VHS (#192): scanlines, color bleed, time-based noise, vignette.
// ASCII-only GLSL source. Noise uses a time-seeded hash (no Math.random).
const FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform float uTime;
uniform float uScanline;
uniform float uScanlineCount;
uniform float uColorBleed;
uniform float uNoise;
uniform float uVignette;
uniform vec2 uResolution;
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}
void main() {
  vec2 uv = vUv;
  // color bleed: shift R/B horizontally
  float bleed = uColorBleed;
  float r = texture2D(tDiffuse, uv + vec2(bleed, 0.0)).r;
  float g = texture2D(tDiffuse, uv).g;
  float b = texture2D(tDiffuse, uv - vec2(bleed, 0.0)).b;
  vec3 col = vec3(r, g, b);
  // scanlines: fixed line count (independent of buffer resolution).
  // 以前は uResolution.y を使い1px周期になって表示時に潰れていた（#196）。
  float sl = 0.5 + 0.5 * sin(uv.y * uScanlineCount * 6.28318530718);
  sl = sl * sl; // 暗線をくっきり（明部を広く・暗線をシャープに）
  col *= 1.0 - uScanline * 0.8 * sl;
  // time-seeded noise
  float n = hash(uv * uResolution + fract(uTime) * 100.0) - 0.5;
  col += n * uNoise;
  // vignette
  vec2 d = uv - 0.5;
  float vig = 1.0 - uVignette * dot(d, d) * 2.0;
  col *= clamp(vig, 0.0, 1.0);
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

class CrtState {
  readonly black = blackTexture();
  readonly material: THREE.ShaderMaterial;
  readonly surface: ShaderSurface;
  constructor() {
    this.material = new THREE.ShaderMaterial({
      vertexShader: NDC_VERTEX,
      fragmentShader: FRAG,
      uniforms: {
        tDiffuse: { value: this.black },
        uTime: { value: 0 },
        uScanline: { value: 0.3 },
        uScanlineCount: { value: 240 },
        uColorBleed: { value: 0.002 },
        uNoise: { value: 0.08 },
        uVignette: { value: 0.3 },
        uResolution: { value: new THREE.Vector2(2, 2) },
      },
      depthTest: false, depthWrite: false,
    });
    this.surface = new ShaderSurface(this.material);
  }
  dispose(): void { this.surface.dispose(); this.black.dispose(); }
}

/** CRT/VHS 質感（texture→texture）。走査線・色にじみ・ノイズ・ビネット（#192）。 */
export const CrtNode: NodeTypeDef = {
  type: "Crt",
  category: "effect",
  description: "node.Crt.desc",
  isSink: true,
  inputs: [{ id: "in", label: "in", type: "texture", description: "node.Crt.port.in" }],
  outputs: [{ id: "texture", label: "tex", type: "texture", description: "node.Crt.port.texture" }],
  params: [
    EFFECT_ENABLED_PARAM,
    { id: "scanline", label: "scanline", kind: "number", default: 0.3, min: 0, max: 1, step: 0.01, description: "node.Crt.param.scanline" },
    { id: "scanlineCount", label: "lines", kind: "number", default: 240, min: 30, max: 600, step: 10, description: "node.Crt.param.scanlineCount" },
    { id: "colorBleed", label: "colorBleed", kind: "number", default: 0.002, min: 0, max: 0.02, step: 0.0005, description: "node.Crt.param.colorBleed" },
    { id: "noise", label: "noise", kind: "number", default: 0.08, min: 0, max: 0.5, step: 0.01, description: "node.Crt.param.noise" },
    { id: "vignette", label: "vignette", kind: "number", default: 0.3, min: 0, max: 1, step: 0.01, description: "node.Crt.param.vignette" },
  ],
  createState: () => new CrtState(),
  disposeState: (state: NodeState) => (state as CrtState).dispose(),
  evaluate(ctx) {
    const s = ctx.state as CrtState | undefined;
    if (!s) return {};
    if (!isEffectEnabled(ctx.param)) return bypassOutput(ctx.input, s.black); // #134 無効時パススルー
    const env = ctx.env;
    if (!env) return {};
    const u = s.material.uniforms;
    u.tDiffuse!.value = (ctx.input("in") as THREE.Texture | undefined) ?? s.black;
    u.uTime!.value = ctx.timeSec;
    u.uScanline!.value = Number(ctx.param("scanline") ?? 0.3);
    u.uScanlineCount!.value = Number(ctx.param("scanlineCount") ?? 240);
    u.uColorBleed!.value = Number(ctx.param("colorBleed") ?? 0.002);
    u.uNoise!.value = Number(ctx.param("noise") ?? 0.08);
    u.uVignette!.value = Number(ctx.param("vignette") ?? 0.3);
    (u.uResolution!.value as THREE.Vector2).set(
      env.renderer.domElement.width, env.renderer.domElement.height,
    );
    return { texture: s.surface.render(env.renderer) };
  },
};
