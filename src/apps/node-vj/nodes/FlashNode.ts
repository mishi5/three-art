import * as THREE from "three";
import type { NodeState, NodeTypeDef } from "../graph/node-type";
import { ShaderSurface, NDC_VERTEX, blackTexture } from "../graph/shader-surface";
import { envelopeValue } from "./EnvelopeNode";

/** Flash の発火状態（純）。立ち上がりエッジで triggerTime を記録し、減衰 level を返す。 */
export class FlashRuntime {
  triggerTime = -Infinity;
  prevTrigger = false;

  feed(fired: boolean, now: number): void {
    if (fired && !this.prevTrigger) this.triggerTime = now;
    this.prevTrigger = fired;
  }

  /** 発火からの減衰 level（即 1 → release で 0）。attack=0 の AD エンベロープ。 */
  getLevel(now: number, release: number): number {
    return envelopeValue(now - this.triggerTime, 0, release);
  }
}

const FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tDiffuse;   // 下地（無接続時は黒）
  uniform vec3 uFlash;          // フラッシュ色
  uniform float uLevel;         // 0..1 減衰レベル
  void main() {
    vec3 base = texture2D(tDiffuse, vUv).rgb;
    gl_FragColor = vec4(min(base + uFlash * uLevel, 1.0), 1.0);
  }
`;

class FlashState {
  readonly run = new FlashRuntime();
  readonly black = blackTexture();
  readonly material: THREE.ShaderMaterial;
  readonly surface: ShaderSurface;
  constructor() {
    this.material = new THREE.ShaderMaterial({
      vertexShader: NDC_VERTEX,
      fragmentShader: FRAG,
      uniforms: {
        tDiffuse: { value: this.black },
        uFlash: { value: new THREE.Color(1, 1, 1) },
        uLevel: { value: 0 },
      },
      depthTest: false, depthWrite: false,
    });
    this.surface = new ShaderSurface(this.material);
  }
  dispose(): void {
    this.surface.dispose();
    this.black.dispose();
  }
}

/** trigger 発火で一瞬フラッシュする effect ノード（#112）。下地 texture があれば加算合成。 */
export const FlashNode: NodeTypeDef = {
  type: "Flash",
  category: "effect",
  isSink: true,
  inputs: [
    { id: "trigger", label: "trig", type: "trigger" },
    { id: "in", label: "in", type: "texture" },
  ],
  outputs: [{ id: "texture", label: "tex", type: "texture" }],
  params: [
    { id: "release", label: "release", kind: "number", default: 0.15, min: 0.01, max: 3, step: 0.01 },
    { id: "hue", label: "hue", kind: "number", default: 0, min: 0, max: 1, step: 0.01 },
    { id: "saturation", label: "saturation", kind: "number", default: 0, min: 0, max: 1, step: 0.01 },
  ],
  createState: () => new FlashState(),
  disposeState: (state: NodeState) => (state as FlashState).dispose(),
  evaluate(ctx) {
    const s = ctx.state as FlashState | undefined;
    const env = ctx.env;
    if (!s || !env) return {};
    s.run.feed(Boolean(ctx.input("trigger")), ctx.timeSec);
    const level = s.run.getLevel(ctx.timeSec, Number(ctx.param("release") ?? 0.15));
    const u = s.material.uniforms;
    u.tDiffuse!.value = (ctx.input("in") as THREE.Texture | undefined) ?? s.black;
    // HSL の lightness=1 は常に白になるため、彩度に応じて明るさを保ちつつ色が出るよう補正
    // （sat=0→白(l=1), sat=1→鮮やかな原色(l=0.5)）。加算合成なので常に明るいフラッシュになる。
    const sat = Number(ctx.param("saturation") ?? 0);
    (u.uFlash!.value as THREE.Color).setHSL(Number(ctx.param("hue") ?? 0), sat, 1 - 0.5 * sat);
    u.uLevel!.value = level;
    return { texture: s.surface.render(env.renderer) };
  },
};
