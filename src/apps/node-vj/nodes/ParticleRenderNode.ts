import * as THREE from "three";
import type { AudioFeatures } from "../../../core/types";
import { DEFAULT_AUDIO_FEATURES } from "../../../core/types";
import type { NodeEnv, NodeState, NodeTypeDef } from "../graph/node-type";
import { VisualSurface } from "../graph/visual-surface";
import type { PointField } from "../graph/point-field";

// 位置テクスチャから中心を読み、ビュー空間でカメラ向きの板（quad）に展開する。
// 粒子径は world 単位なので投影で自然に遠近・解像度追従し、GL points の点サイズ上限が無い。
// ASCII のみの GLSL。
const VERT = /* glsl */ `
  precision highp float;
  attribute float aIndex;      // インスタンスごとの粒子インデックス
  uniform sampler2D uPosTex;
  uniform float uTexW;
  uniform float uTexH;
  uniform float uBaseSize;
  uniform float uVolumeSize;
  uniform float uBassExpansion;
  uniform float uVolume;
  uniform float uBass;
  varying vec2 vUv;
  varying float vSeed;
  varying float vBright;

  void main() {
    float fx = mod(aIndex, uTexW);
    float fy = floor(aIndex / uTexW);
    vec2 puv = (vec2(fx, fy) + 0.5) / vec2(uTexW, uTexH);
    vec3 center = texture2D(uPosTex, puv).rgb;
    vSeed = fract(sin(aIndex * 12.9898) * 43758.5453);
    vBright = clamp(0.7 + 0.45 * uBass + 0.2 * uVolume, 0.0, 1.0);
    // world 径（baseSize 等 × 係数）。上限も world 側で（解像度非依存）。
    float worldDia = min((uBaseSize + uVolume * uVolumeSize + uBass * uBassExpansion) * 0.012, 0.6);
    // ビュー空間で板をカメラ向きに展開（ビルボード）。position は [-0.5,0.5] の quad 角。
    vec4 mvCenter = modelViewMatrix * vec4(center, 1.0);
    mvCenter.xy += position.xy * worldDia;
    vUv = uv;
    gl_Position = projectionMatrix * mvCenter;
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  uniform float uHueBase;
  uniform float uHueSpread;
  uniform float uSaturation;
  varying vec2 vUv;
  varying float vSeed;
  varying float vBright;

  vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }

  void main() {
    vec2 d = vUv - 0.5;
    if (dot(d, d) > 0.25) discard;     // 円形粒子
    float hue = fract(uHueBase + uHueSpread * vSeed);
    gl_FragColor = vec4(hsv2rgb(vec3(hue, uSaturation, vBright)), 1.0);
  }
`;

type UniformKey =
  | "uPosTex" | "uTexW" | "uTexH" | "uBaseSize" | "uVolumeSize" | "uBassExpansion"
  | "uVolume" | "uBass" | "uHueBase" | "uHueSpread" | "uSaturation";
type Uniforms = Record<UniformKey, THREE.IUniform>;

interface ParticleRenderState {
  surface: VisualSurface;
  material: THREE.ShaderMaterial;
  uniforms: Uniforms;
  base: THREE.PlaneGeometry;   // 共有する quad（角 + uv + index）
  geom: THREE.InstancedBufferGeometry;
  mesh: THREE.Mesh;
  count: number;
}

/** count インスタンスぶんの aIndex を持つ instanced quad ジオメトリを作る。 */
function buildGeometry(base: THREE.PlaneGeometry, count: number): THREE.InstancedBufferGeometry {
  const geom = new THREE.InstancedBufferGeometry();
  geom.index = base.index;
  geom.setAttribute("position", base.attributes.position!);
  geom.setAttribute("uv", base.attributes.uv!);
  const idx = new Float32Array(count);
  for (let i = 0; i < count; i++) idx[i] = i;
  geom.setAttribute("aIndex", new THREE.InstancedBufferAttribute(idx, 1));
  geom.instanceCount = count;
  return geom;
}

/** パーティクル描画ノード（#101）。points（位置テクスチャ）をビルボード quad で描画して texture を出力する。 */
export const ParticleRenderNode: NodeTypeDef = {
  type: "ParticleRender",
  category: "visual",
  description: "points（位置テクスチャ）をカメラ向きのビルボード quad で描画する visual。結果を texture 出力する。",
  isSink: true,
  inputs: [
    { id: "points", label: "points", type: "points", description: "描画する GPU 位置テクスチャ参照（未接続なら何も描かない）。" },
    { id: "signal", label: "signal", type: "signal", description: "粒子サイズ・明るさを変調する音響特徴量入力（未接続なら環境の特徴量）。" },
  ],
  outputs: [{ id: "texture", label: "tex", type: "texture", description: "描画結果のテクスチャ。" }],
  params: [
    { id: "baseSize", label: "baseSize", kind: "number", default: 4.0, min: 0.5, max: 40, step: 0.5, description: "粒子の基本サイズ。" },
    { id: "volumeSize", label: "volumeSize", kind: "number", default: 8.0, min: 0, max: 60, step: 0.5, description: "音量に応じて粒子サイズを増す量。" },
    { id: "bassExpansion", label: "bassExpansion", kind: "number", default: 18.0, min: 0, max: 60, step: 0.5, description: "bass に応じて粒子サイズを増す量。" },
    { id: "hueBase", label: "hueBase", kind: "number", default: 0.6, min: 0, max: 1, step: 0.01, description: "基準色相（0〜1）。" },
    { id: "hueSpread", label: "hueSpread", kind: "number", default: 0.4, min: 0, max: 1, step: 0.01, description: "色相の広がり幅（粒子間の色のばらつき）。" },
    { id: "saturation", label: "saturation", kind: "number", default: 0.6, min: 0, max: 1, step: 0.01, description: "彩度（0〜1）。" },
  ],
  createState(): ParticleRenderState {
    const uniforms: Uniforms = {
      uPosTex: { value: null },
      uTexW: { value: 1 }, uTexH: { value: 1 },
      uBaseSize: { value: 4 }, uVolumeSize: { value: 8 }, uBassExpansion: { value: 18 },
      uVolume: { value: 0 }, uBass: { value: 0 },
      uHueBase: { value: 0.6 }, uHueSpread: { value: 0.4 }, uSaturation: { value: 0.6 },
    };
    const material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: false, depthTest: true, uniforms,
    });
    const base = new THREE.PlaneGeometry(1, 1);   // 角 [-0.5,0.5], uv [0,1]
    const geom = buildGeometry(base, 1);
    const mesh = new THREE.Mesh(geom, material);
    mesh.frustumCulled = false;
    const surface = new VisualSurface();
    surface.scene.add(mesh);
    return { surface, material, uniforms, base, geom, mesh, count: 1 };
  },
  disposeState(state: NodeState): void {
    const s = state as ParticleRenderState;
    s.geom.dispose();
    s.base.dispose();
    s.material.dispose();
    s.surface.dispose();
  },
  evaluate(ctx) {
    const s = ctx.state as ParticleRenderState | undefined;
    const env = ctx.env;
    if (!s || !env) return {};
    const field = ctx.input("points") as PointField | undefined;
    if (!field) return {};   // 形状未接続なら描画しない（Screen には何も出ない）

    // count 変化に追従して instanced ジオメトリを作り直す（base quad は共有）。
    if (field.count !== s.count) {
      s.mesh.geometry = buildGeometry(s.base, field.count);
      s.geom.dispose();
      s.geom = s.mesh.geometry as THREE.InstancedBufferGeometry;
      s.count = field.count;
    }

    const audio = (ctx.input("signal") as AudioFeatures | undefined) ?? env.audio ?? DEFAULT_AUDIO_FEATURES;
    const u = s.uniforms;
    u.uPosTex.value = field.texture;
    u.uTexW.value = field.texW;
    u.uTexH.value = field.texH;
    u.uBaseSize.value = Number(ctx.param("baseSize") ?? 4);
    u.uVolumeSize.value = Number(ctx.param("volumeSize") ?? 8);
    u.uBassExpansion.value = Number(ctx.param("bassExpansion") ?? 18);
    u.uHueBase.value = Number(ctx.param("hueBase") ?? 0.6);
    u.uHueSpread.value = Number(ctx.param("hueSpread") ?? 0.4);
    u.uSaturation.value = Number(ctx.param("saturation") ?? 0.6);
    u.uVolume.value = audio.volume;
    u.uBass.value = audio.bass;

    const texture = s.surface.render(env.renderer, env.camera);
    return { texture };
  },
};
