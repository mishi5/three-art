import * as THREE from "three";
import type { NodeState, NodeTypeDef } from "../graph/node-type";
import { PositionFieldPass } from "../graph/position-field-pass";
import type { PointField } from "../graph/point-field";

const DEG = Math.PI / 180;

/**
 * translate / rotate(度) から列優先の mat4 要素（length 16）を合成する純関数。
 * 適用順は回転（原点まわり）→平行移動（M·p = T·R·p）。
 */
export function composeTransformElements(
  tx: number, ty: number, tz: number, rxDeg: number, ryDeg: number, rzDeg: number,
): number[] {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rxDeg * DEG, ryDeg * DEG, rzDeg * DEG));
  m.compose(new THREE.Vector3(tx, ty, tz), q, new THREE.Vector3(1, 1, 1));
  return m.elements.slice();
}

// 入力位置テクスチャを vUv でサンプルし、mat4 を適用して書き出す。ASCII のみ。
const FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D uSrc;
  uniform mat4 uMat;
  varying vec2 vUv;
  void main() {
    vec3 p = texture2D(uSrc, vUv).rgb;
    gl_FragColor = vec4((uMat * vec4(p, 1.0)).xyz, 1.0);
  }
`;

type TransformUniforms = Record<"uSrc" | "uMat", THREE.IUniform>;

interface PointTransformState {
  pass: PositionFieldPass;
  uniforms: TransformUniforms;
  texW: number;
  texH: number;
}

/** 中心移動・方向調整（Transform）ノード（#102）。points を平行移動・回転して points を出力。 */
export const PointTransformNode: NodeTypeDef = {
  type: "PointTransform",
  category: "process",
  description: "点群を平行移動・回転する。回転（原点まわり）→平行移動の順に適用し points を出力する。",
  isSink: false,
  inputs: [{ id: "points", label: "points", type: "points", description: "変換元の GPU 位置テクスチャ参照（未接続は no-op）。" }],
  outputs: [{ id: "points", label: "points", type: "points", description: "変換後の GPU 位置テクスチャ参照。" }],
  params: [
    { id: "translateX", label: "translateX", kind: "number", default: 0, min: -3, max: 3, step: 0.01, description: "X 方向の平行移動（world m）。" },
    { id: "translateY", label: "translateY", kind: "number", default: 0, min: -3, max: 3, step: 0.01, description: "Y 方向の平行移動（world m）。" },
    { id: "translateZ", label: "translateZ", kind: "number", default: 0, min: -3, max: 3, step: 0.01, description: "Z 方向の平行移動（world m）。" },
    { id: "rotateX", label: "rotateX", kind: "number", default: 0, min: -180, max: 180, step: 1, description: "X 軸まわりの回転（度）。" },
    { id: "rotateY", label: "rotateY", kind: "number", default: 0, min: -180, max: 180, step: 1, description: "Y 軸まわりの回転（度）。" },
    { id: "rotateZ", label: "rotateZ", kind: "number", default: 0, min: -180, max: 180, step: 1, description: "Z 軸まわりの回転（度）。" },
  ],
  createState(): PointTransformState {
    const uniforms: TransformUniforms = {
      uSrc: { value: null },
      uMat: { value: new THREE.Matrix4() },
    };
    const pass = new PositionFieldPass(FRAG, uniforms, 1, 1);
    return { pass, uniforms, texW: 1, texH: 1 };
  },
  disposeState(state: NodeState): void {
    (state as PointTransformState).pass.dispose();
  },
  evaluate(ctx) {
    const s = ctx.state as PointTransformState | undefined;
    const env = ctx.env;
    if (!s || !env) return {};
    const field = ctx.input("points") as PointField | undefined;
    if (!field) return {};   // 入力未接続は no-op

    if (field.texW !== s.texW || field.texH !== s.texH) {
      s.pass.setSize(field.texW, field.texH);
      s.texW = field.texW;
      s.texH = field.texH;
    }
    s.uniforms.uSrc.value = field.texture;
    (s.uniforms.uMat.value as THREE.Matrix4).fromArray(composeTransformElements(
      Number(ctx.param("translateX") ?? 0), Number(ctx.param("translateY") ?? 0), Number(ctx.param("translateZ") ?? 0),
      Number(ctx.param("rotateX") ?? 0), Number(ctx.param("rotateY") ?? 0), Number(ctx.param("rotateZ") ?? 0),
    ));
    s.pass.render(env.renderer);
    // #121: 色テクスチャは位置変換の影響を受けないのでそのまま透過する。
    return { points: { texture: s.pass.texture, count: field.count, texW: field.texW, texH: field.texH, colorTexture: field.colorTexture } satisfies PointField };
  },
};
