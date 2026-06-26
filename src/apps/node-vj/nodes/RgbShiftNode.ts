import * as THREE from "three";
import type { NodeState, NodeTypeDef } from "../graph/node-type";
import { ShaderSurface, NDC_VERTEX, blackTexture } from "../graph/shader-surface";
import { envelopeValue } from "./EnvelopeNode";
import { EFFECT_ENABLED_PARAM, isEffectEnabled, bypassOutput } from "./effect-bypass";

/** RGB Shift の発火状態（純）。立ち上がりエッジで triggerTime を記録し、減衰 level を返す。 */
export class RgbShiftRuntime {
  triggerTime = -Infinity;
  prevTrigger = false;

  feed(fired: boolean, now: number): void {
    if (fired && !this.prevTrigger) this.triggerTime = now;
    this.prevTrigger = fired;
  }

  /** 発火からの減衰 level（即 1 → decay で 0）。attack=0 の AD エンベロープ。 */
  getLevel(now: number, decay: number): number {
    return envelopeValue(now - this.triggerTime, 0, decay);
  }
}

// RGB Shift / Chromatic Aberration (#189): offset R/B channels along a direction.
// ASCII-only GLSL source.
const FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform float uAmount;   // base shift (uv units)
uniform vec2 uDir;       // shift direction (unit-ish)
uniform float uAspect;   // width/height, keeps shift visually uniform
void main() {
  vec2 off = uDir * uAmount;
  off.x /= max(0.0001, uAspect);
  float r = texture2D(tDiffuse, vUv + off).r;
  float g = texture2D(tDiffuse, vUv).g;
  float b = texture2D(tDiffuse, vUv - off).b;
  gl_FragColor = vec4(r, g, b, 1.0);
}
`;

class RgbShiftState {
  readonly run = new RgbShiftRuntime();
  readonly black = blackTexture();
  readonly material: THREE.ShaderMaterial;
  readonly surface: ShaderSurface;
  constructor() {
    this.material = new THREE.ShaderMaterial({
      vertexShader: NDC_VERTEX,
      fragmentShader: FRAG,
      uniforms: {
        tDiffuse: { value: this.black },
        uAmount: { value: 0.002 },
        uDir: { value: new THREE.Vector2(1, 0) },
        uAspect: { value: 1 },
      },
      depthTest: false, depthWrite: false,
    });
    this.surface = new ShaderSurface(this.material);
  }
  dispose(): void { this.surface.dispose(); this.black.dispose(); }
}

/** RGB Shift / 色収差（texture→texture）。R/B を逆方向にずらす。trigger で瞬間的に増幅（#189）。 */
export const RgbShiftNode: NodeTypeDef = {
  type: "RgbShift",
  category: "effect",
  description: "R/B チャンネルを逆方向にずらす色収差エフェクト。trigger で一瞬大きくずらせる。",
  isSink: true,
  inputs: [
    { id: "in", label: "in", type: "texture", description: "ずらす元のテクスチャ。" },
    { id: "trigger", label: "trig", type: "trigger", description: "立ち上がりで一瞬ずれ量を増幅する trigger（onset 等）。" },
  ],
  outputs: [{ id: "texture", label: "tex", type: "texture", description: "色収差適用後のテクスチャ。" }],
  params: [
    EFFECT_ENABLED_PARAM,
    { id: "amount", label: "amount", kind: "number", default: 0.003, min: 0, max: 0.05, step: 0.0005, description: "常時のずれ量（UV 単位）。" },
    { id: "angle", label: "angle", kind: "number", default: 0, min: 0, max: 1, step: 0.01, description: "ずらす方向（0〜1 を一周にマップ）。" },
    { id: "triggerAmount", label: "triggerAmount", kind: "number", default: 0.02, min: 0, max: 0.1, step: 0.001, description: "trigger 発火時に加算するずれ量。" },
    { id: "decay", label: "decay", kind: "number", default: 0.15, min: 0.01, max: 2, step: 0.01, description: "trigger 後のずれが戻るまでの時間（秒）。" },
  ],
  createState: () => new RgbShiftState(),
  disposeState: (state: NodeState) => (state as RgbShiftState).dispose(),
  evaluate(ctx) {
    const s = ctx.state as RgbShiftState | undefined;
    if (!s) return {};
    if (!isEffectEnabled(ctx.param)) return bypassOutput(ctx.input, s.black); // #134 無効時パススルー
    const env = ctx.env;
    if (!env) return {};
    s.run.feed(Boolean(ctx.input("trigger")), ctx.timeSec);
    const level = s.run.getLevel(ctx.timeSec, Number(ctx.param("decay") ?? 0.15));
    const amount = Number(ctx.param("amount") ?? 0.003) + level * Number(ctx.param("triggerAmount") ?? 0.02);
    const angle = Number(ctx.param("angle") ?? 0) * Math.PI * 2;
    const u = s.material.uniforms;
    u.tDiffuse!.value = (ctx.input("in") as THREE.Texture | undefined) ?? s.black;
    u.uAmount!.value = amount;
    (u.uDir!.value as THREE.Vector2).set(Math.cos(angle), Math.sin(angle));
    u.uAspect!.value = env.renderer.domElement.width / Math.max(1, env.renderer.domElement.height);
    return { texture: s.surface.render(env.renderer) };
  },
};
