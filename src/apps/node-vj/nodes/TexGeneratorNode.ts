import * as THREE from "three";
import type { NodeState, NodeTypeDef } from "../graph/node-type";
import { ShaderSurface, NDC_VERTEX } from "../graph/shader-surface";

const DEG = Math.PI / 180;

type TexGenMode = "solid" | "linear" | "radial";
const MODE_INT: Record<TexGenMode, number> = { solid: 0, linear: 1, radial: 2 };

/** mode 文字列を shader 用の int に。未知は 1（linear）。 */
export function texGenModeInt(mode: string): number {
  return MODE_INT[mode as TexGenMode] ?? 1;
}

// 入力なしで単色/グラデーション texture を生成する。ASCII のみ。
const FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform float uMode;     // 0=solid, 1=linear, 2=radial
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform float uAngle;    // ラジアン（linear のグラデ方向）
void main() {
  float t;
  if (uMode < 0.5) {
    t = 0.0;                                            // solid = color1
  } else if (uMode < 1.5) {
    vec2 dir = vec2(cos(uAngle), sin(uAngle));          // linear
    t = clamp(dot(vUv - 0.5, dir) + 0.5, 0.0, 1.0);
  } else {
    t = clamp(length(vUv - 0.5) * 2.0, 0.0, 1.0);       // radial（中心→外周）
  }
  gl_FragColor = vec4(mix(uColor1, uColor2, t), 1.0);
}
`;

interface TexGenState {
  surface: ShaderSurface;
}

/** 単色/グラデーションの texture を生成するソースノード（#153）。入力を持たず texture のみ出力。 */
export const TexGeneratorNode: NodeTypeDef = {
  type: "TexGenerator",
  category: "generator",
  description: "入力なしで単色/グラデーション（線形・放射状）の texture を生成するソース。色(RGB)・角度は他ノードから駆動できる。",
  inputs: [],
  outputs: [{ id: "texture", label: "tex", type: "texture", description: "生成した単色/グラデーションのテクスチャ。" }],
  params: [
    { id: "mode", label: "mode", kind: "enum", default: "linear", options: ["solid", "linear", "radial"], description: "solid=単色(color1) / linear=線形グラデ / radial=放射状グラデ。" },
    { id: "r1", label: "color1 R", kind: "number", default: 0.05, min: 0, max: 1, step: 0.01, description: "色1（solid の色 / グラデ始点）の R。" },
    { id: "g1", label: "color1 G", kind: "number", default: 0.10, min: 0, max: 1, step: 0.01, description: "色1の G。" },
    { id: "b1", label: "color1 B", kind: "number", default: 0.30, min: 0, max: 1, step: 0.01, description: "色1の B。" },
    { id: "r2", label: "color2 R", kind: "number", default: 0.90, min: 0, max: 1, step: 0.01, description: "色2（グラデ終点）の R。" },
    { id: "g2", label: "color2 G", kind: "number", default: 0.30, min: 0, max: 1, step: 0.01, description: "色2の G。" },
    { id: "b2", label: "color2 B", kind: "number", default: 0.50, min: 0, max: 1, step: 0.01, description: "色2の B。" },
    { id: "angle", label: "angle", kind: "number", default: 0, min: 0, max: 360, step: 1, description: "線形グラデの角度（度）。" },
  ],
  createState(): TexGenState {
    const surface = new ShaderSurface(new THREE.ShaderMaterial({
      vertexShader: NDC_VERTEX,
      fragmentShader: FRAG,
      uniforms: {
        uMode: { value: 1 },
        uColor1: { value: new THREE.Color(0.05, 0.1, 0.3) },
        uColor2: { value: new THREE.Color(0.9, 0.3, 0.5) },
        uAngle: { value: 0 },
      },
      depthTest: false, depthWrite: false,
    }));
    return { surface };
  },
  disposeState(state: NodeState): void {
    (state as TexGenState).surface.dispose();
  },
  evaluate(ctx) {
    const s = ctx.state as TexGenState | undefined;
    const env = ctx.env;
    if (!s || !env) return {};
    const u = s.surface.material.uniforms;
    u.uMode!.value = texGenModeInt(String(ctx.param("mode") ?? "linear"));
    (u.uColor1!.value as THREE.Color).setRGB(
      Number(ctx.param("r1") ?? 0.05), Number(ctx.param("g1") ?? 0.1), Number(ctx.param("b1") ?? 0.3),
    );
    (u.uColor2!.value as THREE.Color).setRGB(
      Number(ctx.param("r2") ?? 0.9), Number(ctx.param("g2") ?? 0.3), Number(ctx.param("b2") ?? 0.5),
    );
    u.uAngle!.value = Number(ctx.param("angle") ?? 0) * DEG;
    return { texture: s.surface.render(env.renderer) };
  },
};
