import * as THREE from "three";
import type { AudioFeatures, PoseFrame } from "../../../core/types";
import { NUM_JOINTS } from "../../../core/types";
import type { NodeState, NodeTypeDef } from "../graph/node-type";
import { PositionFieldPass } from "../graph/position-field-pass";
import { fieldTexSize, type PointField } from "../graph/point-field";

// 上限は「テクスチャに収まる最大(256^2)」ではなく実用・安全側の値（128^2）。
// 粒子数自体より count×サイズのオーバードローが効くため、過大な上限は事故の元。
export const MAX_COUNT = 16384;

type ShapeMode = "cube" | "sphere" | "lattice" | "bones";
const MODE_INT: Record<ShapeMode, number> = { cube: 0, sphere: 1, lattice: 2, bones: 3 };

const MAX_LATTICE_N = Math.floor(Math.cbrt(MAX_COUNT)); // 40（40^3=64000 <= MAX_COUNT）

/** lattice の格子解像度 N = round(cbrt(count))（最小2・N^3<=MAX_COUNT）。count から導出して param を共通化。 */
export function latticeN(count: number): number {
  const n = Math.round(Math.cbrt(Math.max(1, count)));
  return Math.max(2, Math.min(MAX_LATTICE_N, n));
}

/** mode に依らず count を基準にした実効粒子数（lattice は N^3）。最小1・上限 MAX_COUNT。 */
export function shapeCount(mode: string, count: number): number {
  const c = Math.max(1, Math.min(MAX_COUNT, Math.round(count)));
  if (mode === "lattice") { const n = latticeN(c); return n * n * n; }
  return c;
}

// index を復元し mode で形状を分岐して位置テクスチャに書く。snoise は PointCloud のもの
// （Ashima Arts, public domain）を流用。ASCII のみ。
// 動的 uniform 配列インデックスは GLSL で未定義動作になりうる（threejs-art の既知の罠）。
// 旧 PointCloud と同じく if チェーンで定数添字に展開して回避する。
function buildJointSelector(name: string, retType: string, uni: string): string {
  let s = `  ${retType} ${name}(int jointIdx) {\n`;
  for (let i = 0; i < NUM_JOINTS - 1; i++) {
    s += `    if (jointIdx == ${i}) return ${uni}[${i}];\n`;
  }
  s += `    return ${uni}[${NUM_JOINTS - 1}];\n  }`;
  return s;
}

const FRAG = /* glsl */ `
  precision highp float;
  #define MAX_JOINTS ${NUM_JOINTS}
  uniform float uTexW;
  uniform float uMode;     // 0=cube, 1=sphere, 2=lattice, 3=bones
  uniform float uRadius;
  uniform float uLatticeN;
  uniform float uNoiseAmount;
  uniform float uNoiseScale;
  uniform float uTime;
  uniform float uBass;
  uniform vec3 uJoints[MAX_JOINTS];      // 13 関節の world 座標（bones）
  uniform float uVisibility[MAX_JOINTS]; // 各関節の可視度 0..1（bones）
  uniform vec3 uCenter;                  // 可視度重み付き重心（bones の原点合わせ）

  vec3 hash31(float p) {
    vec3 p3 = fract(vec3(p) * vec3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.xxy + p3.yzz) * p3.zyx);
  }

${buildJointSelector("selectJoint", "vec3", "uJoints")}

${buildJointSelector("selectVisibility", "float", "uVisibility")}

  // ---- 3D simplex noise (Ashima Arts, public domain) ----
  vec3 mod289_v3(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 mod289_v4(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 permute(vec4 x)   { return mod289_v4(((x * 34.0) + 1.0) * x); }
  vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
  float snoise(vec3 v) {
    const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i  = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g  = step(x0.yzx, x0.xyz);
    vec3 l  = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = mod289_v3(i);
    vec4 p = permute(permute(permute(
              i.z + vec4(0.0, i1.z, i2.z, 1.0))
            + i.y + vec4(0.0, i1.y, i2.y, 1.0))
            + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j  = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x  = x_ * ns.x + ns.yyyy;
    vec4 y  = y_ * ns.x + ns.yyyy;
    vec4 h  = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
  }

  vec3 latticeGrid(float idx) {
    float n = max(uLatticeN, 2.0);
    float i = floor(idx + 0.5);
    float ix = mod(i, n);
    float iy = mod(floor(i / n), n);
    float iz = floor(i / (n * n));
    return (vec3(ix, iy, iz) / (n - 1.0) - 0.5) * 2.0 * uRadius;
  }

  void main() {
    float idx = floor(gl_FragCoord.y) * uTexW + floor(gl_FragCoord.x);
    vec3 base;
    float alpha = 1.0;   // bones 以外は常に 1.0（ParticleRender が粒子径マスクに使う）
    if (uMode < 0.5) {
      base = (hash31(idx + 1.0) * 2.0 - 1.0) * uRadius;           // cube（散布）
    } else if (uMode < 1.5) {
      vec3 d = hash31(idx + 1.0) * 2.0 - 1.0;
      base = normalize(d + 0.0001) * uRadius;                     // sphere（球面）
    } else if (uMode < 2.5) {
      base = latticeGrid(idx);                                    // lattice（規則格子）
    } else {
      // bones: 粒子を 13 関節に round-robin 分配し、関節周りにクラスタ散布する。
      int jointIdx = int(mod(idx, float(MAX_JOINTS)) + 0.5);
      vec3 jointPos = selectJoint(jointIdx) - uCenter;
      float vis = selectVisibility(jointIdx);
      vec3 h = hash31(idx + 1.0) * 2.0 - 1.0;                     // [-1,1]^3 のオフセット方向
      float expansion = 1.0 + uBass * 1.5;                        // bass で関節クラスタが膨らむ
      vec3 offset = h * uRadius * expansion;
      float shimmer = sin(uTime * 30.0 + idx * 0.137) * uBass * 0.05;
      offset += normalize(h + 0.0001) * shimmer;
      base = jointPos + offset;
      // 外周の粒子をフェード × 関節の可視度ゲート（映っていない関節の粒子を消す）。
      float dist = length(h);                                     // 0..~1.73
      float visGate = smoothstep(0.2, 0.6, vis);
      alpha = (1.0 - smoothstep(0.6, 1.0, dist)) * visGate;
    }
    // 全 mode 共通の simplex noise 歪み（既定 0=綺麗な形状。bass で増幅）。
    vec3 sc = base * uNoiseScale;
    float t = uTime * 0.15;
    vec3 w = vec3(
      snoise(sc + vec3(0.0, 0.0, t)),
      snoise(sc + vec3(13.1, 5.7, t)),
      snoise(sc + vec3(7.7, 19.3, t))
    );
    vec3 pos = base + w * uNoiseAmount * (1.0 + uBass * 1.5);
    gl_FragColor = vec4(pos, alpha);
  }
`;

type ShapeUniforms = Record<
  | "uTexW" | "uMode" | "uRadius" | "uLatticeN" | "uNoiseAmount" | "uNoiseScale" | "uTime" | "uBass"
  | "uJoints" | "uVisibility" | "uCenter",
  THREE.IUniform
>;

interface PointShapeState {
  pass: PositionFieldPass;
  uniforms: ShapeUniforms;
  count: number;
  field: PointField;
  // bones 用 uniform の実体（毎フレーム pose から詰め直す安定参照）。
  joints: THREE.Vector3[];
  visibility: number[];
  center: THREE.Vector3;
}

/**
 * pose（PoseFrame）から bones 用 uniform（joints/visibility/center）を詰める。
 * pose 未接続（undefined）の場合は全 visibility を 0 にして粒子を不可視化する。
 */
export function packPoseUniforms(
  pose: PoseFrame | undefined,
  joints: THREE.Vector3[],
  visibility: number[],
  center: THREE.Vector3,
): void {
  if (!pose) {
    for (let i = 0; i < visibility.length; i++) visibility[i] = 0;
    return;
  }
  const n = Math.min(joints.length, NUM_JOINTS);
  for (let i = 0; i < n; i++) {
    joints[i]!.set(pose.joints[i * 3]!, pose.joints[i * 3 + 1]!, pose.joints[i * 3 + 2]!);
    visibility[i] = pose.visibility[i] ?? 0;
  }
  center.set(pose.center[0]!, pose.center[1]!, pose.center[2]!);
}

/** 形状生成ノード（#104: cube/sphere/lattice）。位置テクスチャを points として出力する。 */
export const PointShapeNode: NodeTypeDef = {
  type: "PointShape",
  category: "generator",
  description: "cube/sphere/lattice の点群を GPU 生成するノード。位置テクスチャを points として出力する。",
  isSink: false,
  inputs: [
    { id: "signal", label: "signal", type: "signal", description: "bass でノイズ歪み・bones クラスタ膨張を増幅するための音響特徴量入力。" },
    { id: "pose", label: "pose", type: "pose", description: "bones モードで点群を骨格（13関節）に追従させる姿勢入力（任意）。" },
  ],
  outputs: [{ id: "points", label: "points", type: "points", description: "GPU 位置テクスチャ参照（ParticleRender 等の points 入力へ繋ぐ）。" }],
  params: [
    { id: "mode", label: "mode", kind: "enum", default: "cube", options: ["cube", "sphere", "lattice", "bones"], description: "形状。cube=立方体内に散布 / sphere=球面 / lattice=規則格子 / bones=pose の13関節に追従。" },
    { id: "count", label: "count", kind: "int", default: 4000, min: 1, max: MAX_COUNT, step: 1, noInput: true, description: "粒子数（lattice は近い N^3 に丸める）。" },
    { id: "radius", label: "radius", kind: "number", default: 0.5, min: 0.05, max: 3, step: 0.01, description: "形状の半径（world m）。bones では各関節クラスタの広がり。" },
    { id: "noiseAmount", label: "noiseAmount", kind: "number", default: 0, min: 0, max: 1, step: 0.01, description: "simplex noise による歪みの強さ（0=綺麗な形状。bass で増幅される）。" },
    { id: "noiseScale", label: "noiseScale", kind: "number", default: 1.0, min: 0.1, max: 5, step: 0.1, description: "ノイズの空間周波数（大きいほど細かい歪み）。" },
  ],
  createState(): PointShapeState {
    const joints = Array.from({ length: NUM_JOINTS }, () => new THREE.Vector3());
    const visibility = new Array<number>(NUM_JOINTS).fill(0);
    const center = new THREE.Vector3();
    const uniforms: ShapeUniforms = {
      uTexW: { value: 1 }, uMode: { value: 0 }, uRadius: { value: 0.5 },
      uLatticeN: { value: 12 }, uNoiseAmount: { value: 0.15 }, uNoiseScale: { value: 1.0 },
      uTime: { value: 0 }, uBass: { value: 0 },
      uJoints: { value: joints }, uVisibility: { value: visibility }, uCenter: { value: center },
    };
    const pass = new PositionFieldPass(FRAG, uniforms, 1, 1);
    return {
      pass, uniforms, count: 0, field: { texture: pass.texture, count: 0, texW: 1, texH: 1 },
      joints, visibility, center,
    };
  },
  disposeState(state: NodeState): void {
    (state as PointShapeState).pass.dispose();
  },
  evaluate(ctx) {
    const s = ctx.state as PointShapeState | undefined;
    const env = ctx.env;
    if (!s || !env) return {};
    const mode = String(ctx.param("mode") ?? "cube") as ShapeMode;
    const reqCount = Number(ctx.param("count") ?? 4000);
    const count = shapeCount(mode, reqCount);
    if (count !== s.count) {
      const { w, h } = fieldTexSize(count);
      s.pass.setSize(w, h);
      s.uniforms.uTexW.value = w;
      s.count = count;
      s.field = { texture: s.pass.texture, count, texW: w, texH: h };
    }
    const audio = ctx.input("signal") as AudioFeatures | undefined;
    const pose = ctx.input("pose") as PoseFrame | undefined;
    packPoseUniforms(pose, s.joints, s.visibility, s.center);
    const u = s.uniforms;
    u.uMode.value = MODE_INT[mode] ?? 0;
    u.uRadius.value = Number(ctx.param("radius") ?? 0.5);
    u.uLatticeN.value = latticeN(Math.max(1, Math.min(MAX_COUNT, Math.round(reqCount))));
    u.uNoiseAmount.value = Number(ctx.param("noiseAmount") ?? 0.15);
    u.uNoiseScale.value = Number(ctx.param("noiseScale") ?? 1.0);
    u.uTime.value = ctx.timeSec;
    u.uBass.value = audio?.bass ?? 0;
    s.pass.render(env.renderer);
    return { points: s.field };
  },
};
