import * as THREE from "three";
import type { NodeState, NodeTypeDef } from "../graph/node-type";
import { ShaderSurface, NDC_VERTEX, blackTexture } from "../graph/shader-surface";
import { EFFECT_ENABLED_PARAM, isEffectEnabled, bypassOutput } from "./effect-bypass";

// ScreenTone (#290): comic screentone. Converts input luminance into halftone
// dots / parallel lines / crosshatch. auto mode picks the tone per luminance band.

/** mode enum（定義順が uMode の値）。 */
export const SCREEN_TONE_MODES = ["auto", "dot", "line", "cross"] as const;
export type ScreenToneMode = (typeof SCREEN_TONE_MODES)[number];

/** color enum（定義順が uColorMode の値）。 */
export const SCREEN_TONE_COLORS = ["mono", "color"] as const;
export type ScreenToneColor = (typeof SCREEN_TONE_COLORS)[number];

/** enum param（文字列）→ uMode 値。未知は auto(0)。 */
export function screenToneModeToFloat(mode: unknown): number {
  const idx = (SCREEN_TONE_MODES as readonly unknown[]).indexOf(mode);
  return idx >= 0 ? idx : 0;
}

/** enum param（文字列）→ uColorMode 値。未知は mono(0)。 */
export function screenToneColorToFloat(color: unknown): number {
  const idx = (SCREEN_TONE_COLORS as readonly unknown[]).indexOf(color);
  return idx >= 0 ? idx : 0;
}

/** auto モードの輝度帯しきい値（GLSL へ埋め込む・screenToneBandWeights と共有）。
 *  L < solid: ベタ / solid–cross: クロスハッチ / cross–line: 多線 /
 *  line–dot: 網点 / dot <: 白。 */
export const TONE_BANDS = { solid: 0.12, cross: 0.35, line: 0.6, dot: 0.88 } as const;

/** 帯域境界のクロスフェード幅（±この幅を smoothstep で混ぜる）。 */
export const TONE_BAND_FADE = 0.03;

function smoothstep01(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** auto モードの帯域重み（GLSL の autoInk と同じ計算）。
 *  フェード区間が重ならない前提（TONE_BAND_FADE < 帯域幅/2）で総和は常に 1。 */
export function screenToneBandWeights(L: number): {
  solid: number; cross: number; line: number; dot: number; white: number;
} {
  const F = TONE_BAND_FADE;
  const t0 = smoothstep01(TONE_BANDS.solid - F, TONE_BANDS.solid + F, L);
  const t1 = smoothstep01(TONE_BANDS.cross - F, TONE_BANDS.cross + F, L);
  const t2 = smoothstep01(TONE_BANDS.line - F, TONE_BANDS.line + F, L);
  const t3 = smoothstep01(TONE_BANDS.dot - F, TONE_BANDS.dot + F, L);
  return {
    solid: 1 - t0,
    cross: t0 * (1 - t1),
    line: t1 * (1 - t2),
    dot: t2 * (1 - t3),
    white: t3,
  };
}

export interface ScreenToneParams {
  scale: number;
  angle: number; // degrees
  gamma: number;
  mix: number;
}

function clampNumber(v: unknown, def: number, min: number, max: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

/** 数値 param のサニタイズ（NaN/未指定は既定・範囲外はクランプ）。 */
export function sanitizeScreenToneParams(
  raw: Partial<Record<keyof ScreenToneParams, unknown>>,
): ScreenToneParams {
  return {
    scale: clampNumber(raw.scale, 120, 20, 400),
    angle: clampNumber(raw.angle, 45, 0, 180),
    gamma: clampNumber(raw.gamma, 1, 0.2, 3),
    mix: clampNumber(raw.mix, 1, 0, 1),
  };
}

// ASCII-only GLSL. Mode branching uses a float uniform if-chain (int uniform
// branching is unreliable on some drivers). Band thresholds are injected from
// TONE_BANDS so TS tests and the shader share one source of truth.
// AA uses fwidth of the (continuous) tone coordinate instead of fwidth of the
// fract-based distance, which jumps at cell borders and would draw seams.
const FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform vec2 uResolution;
uniform float uMode;      // 0 auto, 1 dot, 2 line, 3 cross
uniform float uScale;     // cells per screen height
uniform float uAngle;     // radians
uniform float uGamma;
uniform float uColorMode; // 0 mono, 1 color
uniform float uMix;

const float B_SOLID = ${TONE_BANDS.solid.toFixed(4)};
const float B_CROSS = ${TONE_BANDS.cross.toFixed(4)};
const float B_LINE = ${TONE_BANDS.line.toFixed(4)};
const float B_DOT = ${TONE_BANDS.dot.toFixed(4)};
const float B_FADE = ${TONE_BAND_FADE.toFixed(4)};
const float CROSS_OFFSET = 1.308996939; // 75 deg in radians

vec2 toneCoord(vec2 uv, float ang) {
  float aspect = uResolution.x / max(uResolution.y, 1.0);
  vec2 p = vec2(uv.x * aspect, uv.y);
  float c = cos(ang);
  float s = sin(ang);
  return mat2(c, -s, s, c) * p * uScale;
}

// halftone dot: area-based coverage, r = 0.7071*sqrt(1-L) fills the cell at L=0.
float dotInk(vec2 uv, float L) {
  vec2 p = toneCoord(uv, uAngle);
  float d = length(fract(p) - 0.5);
  float aa = length(vec2(fwidth(p.x), fwidth(p.y))) * 0.5;
  float r = 0.7071 * sqrt(max(1.0 - L, 0.0));
  return 1.0 - smoothstep(r - aa, r + aa, d);
}

// parallel lines: thickness t = 0.5*(1-L) fills the cell at L=0, vanishes at L=1.
float lineInkAt(vec2 uv, float L, float ang) {
  vec2 p = toneCoord(uv, ang);
  float s = abs(fract(p.y) - 0.5);
  float aa = fwidth(p.y) * 0.5;
  float t = 0.5 * (1.0 - L);
  return 1.0 - smoothstep(t - aa, t + aa, s);
}

// crosshatch: two line directions 75 deg apart (more comic-like than 90 deg).
float crossInk(vec2 uv, float L) {
  float a = lineInkAt(uv, L, uAngle);
  float b = lineInkAt(uv, L, uAngle + CROSS_OFFSET);
  return max(a, b);
}

// auto: pick tone per luminance band, crossfading +-B_FADE around thresholds.
float autoInk(vec2 uv, float L) {
  float t0 = smoothstep(B_SOLID - B_FADE, B_SOLID + B_FADE, L);
  float t1 = smoothstep(B_CROSS - B_FADE, B_CROSS + B_FADE, L);
  float t2 = smoothstep(B_LINE - B_FADE, B_LINE + B_FADE, L);
  float t3 = smoothstep(B_DOT - B_FADE, B_DOT + B_FADE, L);
  float wSolid = 1.0 - t0;
  float wCross = t0 * (1.0 - t1);
  float wLine = t1 * (1.0 - t2);
  float wDot = t2 * (1.0 - t3);
  // white band contributes 0 ink; evaluate all tones unconditionally so
  // derivatives (fwidth) stay well-defined.
  return wSolid
    + wCross * crossInk(uv, L)
    + wLine * lineInkAt(uv, L, uAngle)
    + wDot * dotInk(uv, L);
}

void main() {
  vec4 src = texture2D(tDiffuse, vUv);
  float L = dot(src.rgb, vec3(0.299, 0.587, 0.114));
  L = pow(max(L, 0.0), uGamma);
  float ink;
  if (uMode < 0.5) {
    ink = autoInk(vUv, L);
  } else if (uMode < 1.5) {
    ink = dotInk(vUv, L);
  } else if (uMode < 2.5) {
    ink = lineInkAt(vUv, L, uAngle);
  } else {
    ink = crossInk(vUv, L);
  }
  ink = clamp(ink, 0.0, 1.0);
  // mono: black ink on white paper. color: keep the source hue, slightly darkened.
  vec3 inkCol = (uColorMode < 0.5) ? vec3(0.0) : src.rgb * 0.7;
  vec3 tone = mix(vec3(1.0), inkCol, ink);
  vec3 col = mix(src.rgb, tone, uMix);
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

class ScreenToneState {
  readonly black = blackTexture();
  readonly material: THREE.ShaderMaterial;
  readonly surface: ShaderSurface;
  constructor() {
    this.material = new THREE.ShaderMaterial({
      vertexShader: NDC_VERTEX,
      fragmentShader: FRAG,
      uniforms: {
        tDiffuse: { value: this.black },
        uResolution: { value: new THREE.Vector2(2, 2) },
        uMode: { value: 0.0 },
        uScale: { value: 120 },
        uAngle: { value: (45 * Math.PI) / 180 },
        uGamma: { value: 1 },
        uColorMode: { value: 0.0 },
        uMix: { value: 1 },
      },
      depthTest: false, depthWrite: false,
    });
    this.surface = new ShaderSurface(this.material);
  }
  dispose(): void { this.surface.dispose(); this.black.dispose(); }
}

/** スクリーントーン（texture→texture）。輝度に応じて網点/多線/クロスハッチ化（#290）。 */
export const ScreenToneNode: NodeTypeDef = {
  type: "ScreenTone",
  category: "effect",
  description: "node.ScreenTone.desc",
  isSink: true,
  inputs: [{ id: "in", label: "in", type: "texture", description: "node.ScreenTone.port.in" }],
  outputs: [{ id: "texture", label: "tex", type: "texture", description: "node.ScreenTone.port.texture" }],
  params: [
    EFFECT_ENABLED_PARAM,
    { id: "mode", label: "mode", kind: "enum", default: "auto", options: [...SCREEN_TONE_MODES], description: "node.ScreenTone.param.mode" },
    { id: "scale", label: "scale", kind: "number", default: 120, min: 20, max: 400, step: 1, description: "node.ScreenTone.param.scale" },
    { id: "angle", label: "angle", kind: "number", default: 45, min: 0, max: 180, step: 1, description: "node.ScreenTone.param.angle" },
    { id: "gamma", label: "gamma", kind: "number", default: 1, min: 0.2, max: 3, step: 0.05, description: "node.ScreenTone.param.gamma" },
    { id: "color", label: "color", kind: "enum", default: "mono", options: [...SCREEN_TONE_COLORS], description: "node.ScreenTone.param.color" },
    { id: "mix", label: "mix", kind: "number", default: 1, min: 0, max: 1, step: 0.01, description: "node.ScreenTone.param.mix" },
  ],
  createState: () => new ScreenToneState(),
  disposeState: (state: NodeState) => (state as ScreenToneState).dispose(),
  evaluate(ctx) {
    const s = ctx.state as ScreenToneState | undefined;
    if (!s) return {};
    if (!isEffectEnabled(ctx.param)) return bypassOutput(ctx.input, s.black); // #134 無効時パススルー
    const env = ctx.env;
    if (!env) return {};
    const p = sanitizeScreenToneParams({
      scale: ctx.param("scale"),
      angle: ctx.param("angle"),
      gamma: ctx.param("gamma"),
      mix: ctx.param("mix"),
    });
    const u = s.material.uniforms;
    u.tDiffuse!.value = (ctx.input("in") as THREE.Texture | undefined) ?? s.black;
    (u.uResolution!.value as THREE.Vector2).set(
      env.renderer.domElement.width, env.renderer.domElement.height,
    );
    u.uMode!.value = screenToneModeToFloat(ctx.param("mode"));
    u.uScale!.value = p.scale;
    u.uAngle!.value = (p.angle * Math.PI) / 180;
    u.uGamma!.value = p.gamma;
    u.uColorMode!.value = screenToneColorToFloat(ctx.param("color"));
    u.uMix!.value = p.mix;
    return { texture: s.surface.render(env.renderer) };
  },
};
