import * as THREE from "three";
import type { AudioFeatures } from "../../../core/types";
import { DEFAULT_AUDIO_FEATURES } from "../../../core/types";
import type { NodeEnv, NodeState, NodeTypeDef } from "../graph/node-type";
import { VisualSurface } from "../graph/visual-surface";
import type { PointField } from "../graph/point-field";

// 位置テクスチャを頂点で texelFetch（uv 経由）して点描画する。ASCII のみの GLSL。
const VERT = /* glsl */ `
  precision highp float;
  attribute float aIndex;
  uniform sampler2D uPosTex;
  uniform float uTexW;
  uniform float uTexH;
  uniform float uBaseSize;
  uniform float uVolumeSize;
  uniform float uBassExpansion;
  uniform float uVolume;
  uniform float uBass;
  uniform float uPixelPerWorld;   // drawingBufferHeight/(2 tan(fov/2))。解像度に追従。
  varying float vSeed;
  varying float vBright;

  void main() {
    float fx = mod(aIndex, uTexW);
    float fy = floor(aIndex / uTexW);
    vec2 uv = (vec2(fx, fy) + 0.5) / vec2(uTexW, uTexH);
    vec3 pos = texture2D(uPosTex, uv).rgb;
    vSeed = fract(sin(aIndex * 12.9898) * 43758.5453);
    // bass/volume で明るさも軽く脈動させる（ビート感）。
    vBright = clamp(0.7 + 0.45 * uBass + 0.2 * uVolume, 0.0, 1.0);
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;
    // 粒子径は world サイズ（baseSize 等 × 係数）。pixelPerWorld/-z で透視＋解像度追従。
    float worldDia = (uBaseSize + uVolume * uVolumeSize + uBass * uBassExpansion) * 0.012;
    gl_PointSize = clamp(worldDia * uPixelPerWorld / max(0.05, -mv.z), 1.0, 256.0);
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  uniform float uHueBase;
  uniform float uHueSpread;
  uniform float uSaturation;
  varying float vSeed;
  varying float vBright;

  vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }

  void main() {
    vec2 d = gl_PointCoord - 0.5;
    if (dot(d, d) > 0.25) discard;     // 円形粒子
    float hue = fract(uHueBase + uHueSpread * vSeed);
    gl_FragColor = vec4(hsv2rgb(vec3(hue, uSaturation, vBright)), 1.0);
  }
`;

type UniformKey =
  | "uPosTex" | "uTexW" | "uTexH" | "uBaseSize" | "uVolumeSize" | "uBassExpansion"
  | "uVolume" | "uBass" | "uPixelPerWorld" | "uHueBase" | "uHueSpread" | "uSaturation";
type Uniforms = Record<UniformKey, THREE.IUniform>;

interface ParticleRenderState {
  surface: VisualSurface;
  material: THREE.ShaderMaterial;
  uniforms: Uniforms;
  points: THREE.Points;
  geom: THREE.BufferGeometry;
  count: number;
}

function buildGeometry(count: number): THREE.BufferGeometry {
  const geom = new THREE.BufferGeometry();
  // position は使わない（頂点シェーダがテクスチャから取得）が、頂点数確定のため必要。
  geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  const idx = new Float32Array(count);
  for (let i = 0; i < count; i++) idx[i] = i;
  geom.setAttribute("aIndex", new THREE.BufferAttribute(idx, 1));
  return geom;
}

/** パーティクル描画ノード（#101）。points（位置テクスチャ）を点群描画して texture を出力する。 */
export const ParticleRenderNode: NodeTypeDef = {
  type: "ParticleRender",
  category: "visual",
  isSink: true,
  inputs: [
    { id: "points", label: "points", type: "points" },
    { id: "audio", label: "audio", type: "audio" },
  ],
  outputs: [{ id: "texture", label: "tex", type: "texture" }],
  params: [
    { id: "baseSize", label: "baseSize", kind: "number", default: 4.0, min: 0.5, max: 40, step: 0.5 },
    { id: "volumeSize", label: "volumeSize", kind: "number", default: 8.0, min: 0, max: 60, step: 0.5 },
    { id: "bassExpansion", label: "bassExpansion", kind: "number", default: 18.0, min: 0, max: 60, step: 0.5 },
    { id: "hueBase", label: "hueBase", kind: "number", default: 0.6, min: 0, max: 1, step: 0.01 },
    { id: "hueSpread", label: "hueSpread", kind: "number", default: 0.4, min: 0, max: 1, step: 0.01 },
    { id: "saturation", label: "saturation", kind: "number", default: 0.6, min: 0, max: 1, step: 0.01 },
  ],
  createState(): ParticleRenderState {
    const uniforms: Uniforms = {
      uPosTex: { value: null },
      uTexW: { value: 1 }, uTexH: { value: 1 },
      uBaseSize: { value: 4 }, uVolumeSize: { value: 8 }, uBassExpansion: { value: 18 },
      uVolume: { value: 0 }, uBass: { value: 0 }, uPixelPerWorld: { value: 1000 },
      uHueBase: { value: 0.6 }, uHueSpread: { value: 0.4 }, uSaturation: { value: 0.6 },
    };
    const material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: false, depthTest: true, uniforms,
    });
    const geom = buildGeometry(1);
    const points = new THREE.Points(geom, material);
    points.frustumCulled = false;
    const surface = new VisualSurface();
    surface.scene.add(points);
    return { surface, material, uniforms, points, geom, count: 1 };
  },
  disposeState(state: NodeState): void {
    const s = state as ParticleRenderState;
    s.geom.dispose();
    s.material.dispose();
    s.surface.dispose();
  },
  evaluate(ctx) {
    const s = ctx.state as ParticleRenderState | undefined;
    const env = ctx.env;
    if (!s || !env) return {};
    const field = ctx.input("points") as PointField | undefined;
    if (!field) return {};   // 形状未接続なら描画しない（Screen には何も出ない）

    // count 変化に追従して geometry を作り直す。
    if (field.count !== s.count) {
      s.surface.scene.remove(s.points);
      s.geom.dispose();
      s.geom = buildGeometry(field.count);
      s.points = new THREE.Points(s.geom, s.material);
      s.points.frustumCulled = false;
      s.surface.scene.add(s.points);
      s.count = field.count;
    }

    const audio = (ctx.input("audio") as AudioFeatures | undefined) ?? env.audio ?? DEFAULT_AUDIO_FEATURES;
    const u = s.uniforms;
    u.uPosTex.value = field.texture;
    u.uTexW.value = field.texW;
    u.uTexH.value = field.texH;
    u.uBaseSize.value = Number(ctx.param("baseSize") ?? 6);
    u.uVolumeSize.value = Number(ctx.param("volumeSize") ?? 8);
    u.uBassExpansion.value = Number(ctx.param("bassExpansion") ?? 4);
    u.uHueBase.value = Number(ctx.param("hueBase") ?? 0.6);
    u.uHueSpread.value = Number(ctx.param("hueSpread") ?? 0.4);
    u.uSaturation.value = Number(ctx.param("saturation") ?? 0.6);
    u.uVolume.value = audio.volume;
    u.uBass.value = audio.bass;
    // 解像度追従の点サイズ係数（PointCloud.setProjection と同じ）。
    const fovYRad = (env.camera.fov * Math.PI) / 180;
    u.uPixelPerWorld.value = env.renderer.domElement.height / (2 * Math.tan(fovYRad / 2));

    const texture = s.surface.render(env.renderer, env.camera);
    return { texture };
  },
};
