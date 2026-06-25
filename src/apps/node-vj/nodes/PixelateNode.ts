import * as THREE from "three";
import type { NodeState, NodeTypeDef } from "../graph/node-type";
import { ShaderSurface, NDC_VERTEX, blackTexture } from "../graph/shader-surface";
import { EFFECT_ENABLED_PARAM, isEffectEnabled, bypassOutput } from "./effect-bypass";

/** blockSize(px) から画面の分割ブロック数を出す（0 除算・0 ブロックを防ぐ）。 */
export function pixelateBlocks(w: number, h: number, blockSize: number): { x: number; y: number } {
  const b = Math.max(1, blockSize);
  return { x: Math.max(1, w / b), y: Math.max(1, h / b) };
}

// Pixelate / Mosaic (#190): snap UV to a block grid, optional posterize.
// ASCII-only GLSL source.
const FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform vec2 uBlocks;   // number of blocks across width/height
uniform float uLevels;  // posterize steps (< 2 = off)
void main() {
  vec2 uv = (floor(vUv * uBlocks) + 0.5) / uBlocks;
  vec3 c = texture2D(tDiffuse, uv).rgb;
  if (uLevels >= 2.0) {
    c = floor(c * uLevels) / (uLevels - 1.0);
  }
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
`;

class PixelateState {
  readonly black = blackTexture();
  readonly material: THREE.ShaderMaterial;
  readonly surface: ShaderSurface;
  constructor() {
    this.material = new THREE.ShaderMaterial({
      vertexShader: NDC_VERTEX,
      fragmentShader: FRAG,
      uniforms: {
        tDiffuse: { value: this.black },
        uBlocks: { value: new THREE.Vector2(40, 30) },
        uLevels: { value: 0 },
      },
      depthTest: false, depthWrite: false,
    });
    this.surface = new ShaderSurface(this.material);
  }
  dispose(): void { this.surface.dispose(); this.black.dispose(); }
}

/** Pixelate/モザイク（texture→texture）。UV をブロックにスナップ＋任意の posterize（#190）。 */
export const PixelateNode: NodeTypeDef = {
  type: "Pixelate",
  category: "effect",
  description: "画面をブロック状に粗くするモザイク。posterize で色階調も粗くできる。",
  isSink: true,
  inputs: [{ id: "in", label: "in", type: "texture", description: "モザイクをかける元のテクスチャ。" }],
  outputs: [{ id: "texture", label: "tex", type: "texture", description: "モザイク適用後のテクスチャ。" }],
  params: [
    EFFECT_ENABLED_PARAM,
    { id: "blockSize", label: "blockSize", kind: "number", default: 16, min: 1, max: 128, step: 1, description: "1 ブロックのピクセル数。大きいほど粗い。" },
    { id: "posterize", label: "posterize", kind: "int", default: 0, min: 0, max: 16, step: 1, description: "色階調の段数。2 以上で量子化、0/1 で無効。" },
  ],
  createState: () => new PixelateState(),
  disposeState: (state: NodeState) => (state as PixelateState).dispose(),
  evaluate(ctx) {
    const s = ctx.state as PixelateState | undefined;
    if (!s) return {};
    if (!isEffectEnabled(ctx.param)) return bypassOutput(ctx.input, s.black); // #134 無効時パススルー
    const env = ctx.env;
    if (!env) return {};
    const w = env.renderer.domElement.width;
    const h = env.renderer.domElement.height;
    const blocks = pixelateBlocks(w, h, Number(ctx.param("blockSize") ?? 16));
    const u = s.material.uniforms;
    u.tDiffuse!.value = (ctx.input("in") as THREE.Texture | undefined) ?? s.black;
    (u.uBlocks!.value as THREE.Vector2).set(blocks.x, blocks.y);
    u.uLevels!.value = Number(ctx.param("posterize") ?? 0);
    return { texture: s.surface.render(env.renderer) };
  },
};
