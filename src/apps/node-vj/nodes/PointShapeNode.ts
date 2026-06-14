import * as THREE from "three";
import type { NodeEnv, NodeState, NodeTypeDef } from "../graph/node-type";
import { PositionFieldPass } from "../graph/position-field-pass";
import { fieldTexSize, type PointField } from "../graph/point-field";

// 各テクセル(=粒子)について index を復元し、ハッシュで立方体内に座標を散らす。
// （#101 は cube のみ。#104 で sphere/lattice/image/bones を追加する。）
const FRAG = /* glsl */ `
  precision highp float;
  uniform float uTexW;
  uniform float uRadius;

  // 公開ドメインのハッシュ（Dave Hoskins, hash without sine）。ASCII のみ。
  vec3 hash31(float p) {
    vec3 p3 = fract(vec3(p) * vec3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.xxy + p3.yzz) * p3.zyx);
  }

  void main() {
    float idx = floor(gl_FragCoord.y) * uTexW + floor(gl_FragCoord.x);
    vec3 r = hash31(idx + 1.0);
    vec3 pos = (r * 2.0 - 1.0) * uRadius;   // 立方体内に均等散布
    gl_FragColor = vec4(pos, 1.0);
  }
`;

type ShapeUniforms = Record<"uTexW" | "uRadius", THREE.IUniform>;

interface PointShapeState {
  pass: PositionFieldPass;
  uniforms: ShapeUniforms;
  count: number;
  field: PointField;
}

const MAX_COUNT = 65536;

/** 形状生成ノード（#101: cube のみ）。位置テクスチャを points として出力する。 */
export const PointShapeNode: NodeTypeDef = {
  type: "PointShape",
  category: "input",
  isSink: false,
  inputs: [],
  outputs: [{ id: "points", label: "points", type: "points" }],
  params: [
    { id: "count", label: "count", kind: "int", default: 4000, min: 1, max: MAX_COUNT, step: 1, noInput: true },
    { id: "radius", label: "radius", kind: "number", default: 0.5, min: 0.05, max: 3, step: 0.01 },
  ],
  createState(): PointShapeState {
    const uniforms: ShapeUniforms = {
      uTexW: { value: 1 },
      uRadius: { value: 0.5 },
    };
    const pass = new PositionFieldPass(FRAG, uniforms, 1, 1);
    return { pass, uniforms, count: 0, field: { texture: pass.texture, count: 0, texW: 1, texH: 1 } };
  },
  disposeState(state: NodeState): void {
    (state as PointShapeState).pass.dispose();
  },
  evaluate(ctx) {
    const s = ctx.state as PointShapeState | undefined;
    const env = ctx.env;
    if (!s || !env) return {};
    const count = Math.max(1, Math.min(MAX_COUNT, Math.round(Number(ctx.param("count") ?? 4000))));
    const radius = Number(ctx.param("radius") ?? 0.5);
    if (count !== s.count) {
      const { w, h } = fieldTexSize(count);
      s.pass.setSize(w, h);
      s.uniforms.uTexW.value = w;
      s.count = count;
      s.field = { texture: s.pass.texture, count, texW: w, texH: h };
    }
    s.uniforms.uRadius.value = radius;
    s.pass.render(env.renderer);
    return { points: s.field };
  },
};
