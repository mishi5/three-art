import * as THREE from "three";
import type { NodeState, NodeTypeDef } from "../graph/node-type";
import { ShaderSurface, NDC_VERTEX, blackTexture } from "../graph/shader-surface";

type KeyMode = "chroma" | "luma";
const MODE_INT: Record<KeyMode, number> = { chroma: 0, luma: 1 };

/** mode 文字列を shader 用の int に。未知は 0（chroma）。 */
export function keyModeInt(mode: string): number {
  return MODE_INT[mode as KeyMode] ?? 0;
}

// 前景 fg をクロマ/ルマキーで抜き、背景 bg と合成する。ASCII のみ。
const FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tFg;
uniform sampler2D tBg;
uniform float uMode;        // 0=chroma, 1=luma
uniform vec3 uKey;          // chroma キー色
uniform float uThreshold;
uniform float uSoftness;
uniform float uSpill;
uniform float uInvert;
void main() {
  vec3 fg = texture2D(tFg, vUv).rgb;
  vec3 bg = texture2D(tBg, vUv).rgb;
  float keep;                                  // 1=fg を残す, 0=bg を出す
  vec3 col = fg;
  if (uMode < 0.5) {
    // chroma: キー色からの距離が小さいほど抜く
    float d = distance(fg, uKey);
    keep = smoothstep(uThreshold, uThreshold + uSoftness + 1e-4, d);
    // スピル抑制: エッジ付近のキー色かぶりを輝度グレーへ寄せて除去
    float spillAmt = (1.0 - keep) * uSpill;
    float fgl = dot(fg, vec3(0.299, 0.587, 0.114));
    col = mix(fg, vec3(fgl), spillAmt);
  } else {
    // luma: 輝度がしきい値以上を残す
    float l = dot(fg, vec3(0.299, 0.587, 0.114));
    keep = smoothstep(uThreshold, uThreshold + uSoftness + 1e-4, l);
  }
  if (uInvert > 0.5) keep = 1.0 - keep;
  gl_FragColor = vec4(mix(bg, col, keep), 1.0);
}
`;

class KeyState {
  readonly black = blackTexture();
  readonly surface: ShaderSurface;
  constructor() {
    this.surface = new ShaderSurface(new THREE.ShaderMaterial({
      vertexShader: NDC_VERTEX,
      fragmentShader: FRAG,
      uniforms: {
        tFg: { value: this.black },
        tBg: { value: this.black },
        uMode: { value: 0 },
        uKey: { value: new THREE.Color(0, 1, 0) },
        uThreshold: { value: 0.3 },
        uSoftness: { value: 0.2 },
        uSpill: { value: 0.5 },
        uInvert: { value: 0 },
      },
      depthTest: false, depthWrite: false,
    }));
  }
  dispose(): void { this.surface.dispose(); this.black.dispose(); }
}

/** マスク/キーイング（合成）ノード（#157）。fg をクロマ/ルマキーで抜き bg と合成して出力。 */
export const KeyNode: NodeTypeDef = {
  type: "Key",
  category: "visual",
  description: "node.Key.desc",
  isSink: true,
  inputs: [
    { id: "fg", label: "fg", type: "texture", description: "node.Key.port.fg" },
    { id: "bg", label: "bg", type: "texture", description: "node.Key.port.bg" },
  ],
  outputs: [{ id: "texture", label: "tex", type: "texture", description: "node.Key.port.texture" }],
  params: [
    { id: "mode", label: "mode", kind: "enum", default: "chroma", options: ["chroma", "luma"], description: "node.Key.param.mode" },
    { id: "keyR", label: "key R", kind: "number", default: 0, min: 0, max: 1, step: 0.01, description: "node.Key.param.keyR" },
    { id: "keyG", label: "key G", kind: "number", default: 1, min: 0, max: 1, step: 0.01, description: "node.Key.param.keyG" },
    { id: "keyB", label: "key B", kind: "number", default: 0, min: 0, max: 1, step: 0.01, description: "node.Key.param.keyB" },
    { id: "threshold", label: "threshold", kind: "number", default: 0.3, min: 0, max: 1.5, step: 0.01, description: "node.Key.param.threshold" },
    { id: "softness", label: "softness", kind: "number", default: 0.2, min: 0, max: 1, step: 0.01, description: "node.Key.param.softness" },
    { id: "spill", label: "spill", kind: "number", default: 0.5, min: 0, max: 1, step: 0.01, description: "node.Key.param.spill" },
    { id: "invert", label: "invert", kind: "enum", default: "off", options: ["off", "on"], description: "node.Key.param.invert" },
  ],
  createState: () => new KeyState(),
  disposeState: (state: NodeState) => (state as KeyState).dispose(),
  evaluate(ctx) {
    const s = ctx.state as KeyState | undefined;
    const env = ctx.env;
    if (!s || !env) return {};
    const u = s.surface.material.uniforms;
    u.tFg!.value = (ctx.input("fg") as THREE.Texture | undefined) ?? s.black;
    u.tBg!.value = (ctx.input("bg") as THREE.Texture | undefined) ?? s.black;
    u.uMode!.value = keyModeInt(String(ctx.param("mode") ?? "chroma"));
    (u.uKey!.value as THREE.Color).setRGB(
      Number(ctx.param("keyR") ?? 0), Number(ctx.param("keyG") ?? 1), Number(ctx.param("keyB") ?? 0),
    );
    u.uThreshold!.value = Number(ctx.param("threshold") ?? 0.3);
    u.uSoftness!.value = Number(ctx.param("softness") ?? 0.2);
    u.uSpill!.value = Number(ctx.param("spill") ?? 0.5);
    u.uInvert!.value = ctx.param("invert") === "on" ? 1 : 0;
    return { texture: s.surface.render(env.renderer) };
  },
};
