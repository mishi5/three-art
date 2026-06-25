import * as THREE from "three";
import type { NodeState, NodeTypeDef } from "../graph/node-type";
import { ShaderSurface, NDC_VERTEX, blackTexture } from "../graph/shader-surface";
import { EFFECT_ENABLED_PARAM, isEffectEnabled, bypassOutput } from "./effect-bypass";

// Bloom / Glow (#188): bright-pass extract -> gaussian blur (h/v) -> additive composite.
// ASCII-only GLSL source (WebGL1 GLSL ES 1.00 requirement).

// pass1: keep only pixels brighter than threshold (soft knee), zero elsewhere.
const EXTRACT_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform float uThreshold;
void main() {
  vec3 c = texture2D(tDiffuse, vUv).rgb;
  float l = max(max(c.r, c.g), c.b);
  float knee = smoothstep(uThreshold, min(1.0, uThreshold + 0.1), l);
  gl_FragColor = vec4(c * knee, 1.0);
}
`;

// pass2/3: separable gaussian blur (9-tap), direction set per pass.
const BLUR_FRAG = /* glsl */ `
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

// pass4: original + bloom * intensity (additive).
const COMPOSITE_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform sampler2D tBloom;
uniform float uIntensity;
void main() {
  vec3 base = texture2D(tDiffuse, vUv).rgb;
  vec3 bloom = texture2D(tBloom, vUv).rgb;
  gl_FragColor = vec4(min(base + bloom * uIntensity, vec3(1.0)), 1.0);
}
`;

class BloomState {
  readonly black = blackTexture();
  readonly extractMat: THREE.ShaderMaterial;
  readonly blurMat: THREE.ShaderMaterial;
  readonly compositeMat: THREE.ShaderMaterial;
  readonly extract: ShaderSurface;
  readonly blurH: ShaderSurface;
  readonly blurV: ShaderSurface;
  readonly composite: ShaderSurface;

  constructor() {
    this.extractMat = new THREE.ShaderMaterial({
      vertexShader: NDC_VERTEX,
      fragmentShader: EXTRACT_FRAG,
      uniforms: {
        tDiffuse: { value: this.black },
        uThreshold: { value: 0.7 },
      },
      depthTest: false, depthWrite: false,
    });
    this.blurMat = new THREE.ShaderMaterial({
      vertexShader: NDC_VERTEX,
      fragmentShader: BLUR_FRAG,
      uniforms: {
        tDiffuse: { value: this.black },
        uTexel: { value: new THREE.Vector2(1 / 2, 1 / 2) },
        uDirection: { value: new THREE.Vector2(1, 0) },
        uRadius: { value: 4 },
      },
      depthTest: false, depthWrite: false,
    });
    this.compositeMat = new THREE.ShaderMaterial({
      vertexShader: NDC_VERTEX,
      fragmentShader: COMPOSITE_FRAG,
      uniforms: {
        tDiffuse: { value: this.black },
        tBloom: { value: this.black },
        uIntensity: { value: 1 },
      },
      depthTest: false, depthWrite: false,
    });
    this.extract = new ShaderSurface(this.extractMat);
    this.blurH = new ShaderSurface(this.blurMat);
    this.blurV = new ShaderSurface(this.blurMat);
    this.composite = new ShaderSurface(this.compositeMat);
  }

  dispose(): void {
    this.extract.dispose();
    this.blurH.dispose();
    this.blurV.dispose(); // blurMat 共有のため二重 dispose だが three 側で安全
    this.composite.dispose();
    this.black.dispose();
  }
}

/** Bloom/Glow（texture→texture）。明部抽出→ぼかし→加算合成で発光感を足す（#188）。 */
export const BloomNode: NodeTypeDef = {
  type: "Bloom",
  category: "effect",
  description: "明るい部分を抽出してぼかし、元画像へ加算合成して発光（グロー）させるエフェクト。",
  isSink: true,
  inputs: [{ id: "in", label: "in", type: "texture", description: "発光させる元のテクスチャ。" }],
  outputs: [{ id: "texture", label: "tex", type: "texture", description: "グロー適用後のテクスチャ。" }],
  params: [
    EFFECT_ENABLED_PARAM,
    { id: "threshold", label: "threshold", kind: "number", default: 0.7, min: 0, max: 1, step: 0.01, description: "光らせる明るさの下限。低いほど広く光る。" },
    { id: "intensity", label: "intensity", kind: "number", default: 1, min: 0, max: 3, step: 0.01, description: "発光の強さ（加算量）。" },
    { id: "radius", label: "radius", kind: "number", default: 4, min: 0.5, max: 20, step: 0.1, description: "滲みの広がり（ぼかし半径）。" },
  ],
  createState: () => new BloomState(),
  disposeState: (state: NodeState) => (state as BloomState).dispose(),
  evaluate(ctx) {
    const s = ctx.state as BloomState | undefined;
    if (!s) return {};
    if (!isEffectEnabled(ctx.param)) return bypassOutput(ctx.input, s.black); // #134 無効時パススルー
    const env = ctx.env;
    if (!env) return {};
    const input = (ctx.input("in") as THREE.Texture | undefined) ?? s.black;
    const intensity = Number(ctx.param("intensity") ?? 1);
    if (intensity <= 0) return { texture: input }; // 発光ゼロはパススルー
    const w = env.renderer.domElement.width;
    const h = env.renderer.domElement.height;
    const radius = Number(ctx.param("radius") ?? 4);

    // pass1: bright extract
    const ex = s.extractMat.uniforms;
    ex.tDiffuse!.value = input;
    ex.uThreshold!.value = Number(ctx.param("threshold") ?? 0.7);
    const bright = s.extract.render(env.renderer);

    // pass2/3: separable blur
    const bu = s.blurMat.uniforms;
    (bu.uTexel!.value as THREE.Vector2).set(1 / Math.max(1, w), 1 / Math.max(1, h));
    bu.uRadius!.value = radius;
    bu.tDiffuse!.value = bright;
    (bu.uDirection!.value as THREE.Vector2).set(1, 0);
    const blurredH = s.blurH.render(env.renderer);
    bu.tDiffuse!.value = blurredH;
    (bu.uDirection!.value as THREE.Vector2).set(0, 1);
    const bloomTex = s.blurV.render(env.renderer);

    // pass4: additive composite
    const cu = s.compositeMat.uniforms;
    cu.tDiffuse!.value = input;
    cu.tBloom!.value = bloomTex;
    cu.uIntensity!.value = intensity;
    return { texture: s.composite.render(env.renderer) };
  },
};
