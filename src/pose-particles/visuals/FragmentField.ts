import * as THREE from "three";
import { NUM_JOINTS, type AudioFeatures, type Joints } from "../types";
import type { Settings } from "../settings";
import { axisToInt, effectiveTwistStrength, twistPhase } from "./twist";

const FRAGMENT_COUNT = 10000;
const FIELD_SIZE = 3.0; // メートル

const vertexShader = /* glsl */ `
  #define MAX_JOINTS 13

  uniform vec3 uJoints[MAX_JOINTS];
  uniform float uVisibility[MAX_JOINTS];
  uniform vec3 uCenter;
  uniform float uTime;
  uniform float uVolume;
  uniform float uMid;
  uniform float uPixelRatio;
  uniform float uDriftBase;
  uniform float uMidDrift;
  uniform float uJointPull;
  uniform float uNoiseScale;
  uniform float uTimeSpeed;
  uniform float uHueBase;
  uniform float uHueSpread;
  uniform float uBassHueShift;
  uniform float uBass;
  uniform float uTreble;
  uniform float uSaturation;
  uniform float uTrebleBoost;
  uniform float uTwistStrength;
  uniform float uTwistPhase;
  uniform float uTwistAxis;

  attribute vec3 aBasePosition;
  attribute float aSeed;

  varying float vAlpha;
  varying vec3 vColor;

  vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }

  vec3 applyTwist(vec3 p, float strength, float phase, float axis) {
    if (strength == 0.0 && phase == 0.0) return p;
    float s;
    if (axis < 0.5)      s = p.x;
    else if (axis < 1.5) s = p.y;
    else                 s = p.z;
    float a = strength * s + phase;
    float c = cos(a);
    float sn = sin(a);
    if (axis < 0.5) {
      return vec3(p.x, p.y * c - p.z * sn, p.y * sn + p.z * c);
    } else if (axis < 1.5) {
      return vec3(p.x * c - p.z * sn, p.y, p.x * sn + p.z * c);
    }
    return vec3(p.x * c - p.y * sn, p.x * sn + p.y * c, p.z);
  }

  vec3 hash3(vec3 p) {
    p = vec3(
      dot(p, vec3(127.1, 311.7, 74.7)),
      dot(p, vec3(269.5, 183.3, 246.1)),
      dot(p, vec3(113.5, 271.9, 124.6))
    );
    return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
  }

  vec3 curlNoise(vec3 p) {
    float e = 0.05;
    vec3 dx = vec3(e, 0.0, 0.0);
    vec3 dy = vec3(0.0, e, 0.0);
    vec3 dz = vec3(0.0, 0.0, e);
    vec3 px0 = hash3(p - dx); vec3 px1 = hash3(p + dx);
    vec3 py0 = hash3(p - dy); vec3 py1 = hash3(p + dy);
    vec3 pz0 = hash3(p - dz); vec3 pz1 = hash3(p + dz);
    vec3 dFdx = (px1 - px0) / (2.0 * e);
    vec3 dFdy = (py1 - py0) / (2.0 * e);
    vec3 dFdz = (pz1 - pz0) / (2.0 * e);
    return vec3(dFdy.z - dFdz.y, dFdz.x - dFdx.z, dFdx.y - dFdy.x);
  }

  void main() {
    vec3 base = aBasePosition;
    vec3 drift = curlNoise(base * uNoiseScale + uTime * uTimeSpeed) * (uDriftBase + uMid * uMidDrift);
    vec3 pos = base + drift;

    // 13 joints: inverse-square pull, weighted by visibility, recentred
    vec3 force = vec3(0.0);
    for (int i = 0; i < MAX_JOINTS; i++) {
      vec3 toJoint = (uJoints[i] - uCenter) - pos;
      float d2 = dot(toJoint, toJoint) + 0.05;
      force += toJoint / d2 * uVisibility[i];
    }
    pos += force * uJointPull;

    // twist around body centre (uCenter)
    pos = applyTwist(pos - uCenter, uTwistStrength, uTwistPhase, uTwistAxis) + uCenter;

    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = (1.5 + uVolume * 1.5) * uPixelRatio * (1.0 / -mv.z);
    vAlpha = 0.4 + uVolume * 0.4;

    float hue = fract(uHueBase + (aSeed - 0.5) * uHueSpread + uBass * uBassHueShift);
    float bright = 0.85 * (1.0 + uTreble * uTrebleBoost);
    vColor = hsv2rgb(vec3(hue, uSaturation, bright));
  }
`;

const fragmentShader = /* glsl */ `
  precision mediump float;
  varying float vAlpha;
  varying vec3 vColor;

  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    float circle = 1.0 - smoothstep(0.35, 0.5, d);
    if (circle < 0.01) discard;
    gl_FragColor = vec4(vColor, circle * vAlpha);
  }
`;

export class FragmentField {
  readonly object3D: THREE.Points;
  private material: THREE.ShaderMaterial;

  constructor(pixelRatio: number) {
    const geom = new THREE.BufferGeometry();
    const basePos = new Float32Array(FRAGMENT_COUNT * 3);
    const seeds = new Float32Array(FRAGMENT_COUNT);
    for (let i = 0; i < FRAGMENT_COUNT; i++) {
      basePos[i * 3 + 0] = (Math.random() - 0.5) * FIELD_SIZE;
      basePos[i * 3 + 1] = (Math.random() - 0.5) * FIELD_SIZE;
      basePos[i * 3 + 2] = (Math.random() - 0.5) * FIELD_SIZE;
      seeds[i] = Math.random();
    }
    geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(FRAGMENT_COUNT * 3), 3));
    geom.setAttribute("aBasePosition", new THREE.BufferAttribute(basePos, 3));
    geom.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
    geom.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), FIELD_SIZE);

    const jointVecs: THREE.Vector3[] = [];
    for (let i = 0; i < NUM_JOINTS; i++) jointVecs.push(new THREE.Vector3());

    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uJoints: { value: jointVecs },
        uVisibility: { value: new Array(NUM_JOINTS).fill(0) },
        uCenter: { value: new THREE.Vector3() },
        uTime: { value: 0 },
        uVolume: { value: 0 },
        uMid: { value: 0 },
        uPixelRatio: { value: pixelRatio },
        uDriftBase: { value: 0.3 },
        uMidDrift: { value: 0.5 },
        uJointPull: { value: 0.02 },
        uNoiseScale: { value: 0.5 },
        uTimeSpeed: { value: 0.1 },
        uHueBase: { value: 0.6 },
        uHueSpread: { value: 0.0 },
        uBassHueShift: { value: 0.0 },
        uBass: { value: 0 },
        uTreble: { value: 0 },
        uSaturation: { value: 0.0 },
        uTrebleBoost: { value: 0.3 },
        uTwistStrength: { value: 0 },
        uTwistPhase: { value: 0 },
        uTwistAxis: { value: 1 },
      },
    });

    this.object3D = new THREE.Points(geom, this.material);
    this.object3D.frustumCulled = false;
  }

  update(
    joints: Joints,
    visibility: Float32Array,
    center: Float32Array,
    audio: AudioFeatures,
    settings: Settings,
    timeSec: number,
  ): void {
    const u = this.material.uniforms;
    const arr = u.uJoints!.value as THREE.Vector3[];
    for (let i = 0; i < NUM_JOINTS; i++) {
      arr[i]!.set(joints[i * 3]!, joints[i * 3 + 1]!, joints[i * 3 + 2]!);
    }
    const vis = u.uVisibility!.value as number[];
    for (let i = 0; i < NUM_JOINTS; i++) {
      vis[i] = visibility[i] ?? 0;
    }
    (u.uCenter!.value as THREE.Vector3).set(center[0] ?? 0, center[1] ?? 0, center[2] ?? 0);
    u.uTime!.value = timeSec;
    u.uVolume!.value = audio.volume;
    u.uMid!.value = audio.mid;
    u.uBass!.value = audio.bass;
    u.uTreble!.value = audio.treble;
    u.uDriftBase!.value = settings.fragmentField.driftBase;
    u.uMidDrift!.value = settings.fragmentField.midDrift;
    u.uJointPull!.value = settings.fragmentField.jointPull;
    u.uNoiseScale!.value = settings.fragmentField.noiseScale;
    u.uTimeSpeed!.value = settings.fragmentField.timeSpeed;
    u.uHueBase!.value = settings.color.hueBase;
    u.uHueSpread!.value = settings.color.hueSpread;
    u.uBassHueShift!.value = settings.color.bassHueShift;
    u.uSaturation!.value = settings.color.saturation;
    u.uTrebleBoost!.value = settings.color.trebleBoost;
    u.uTwistStrength!.value = effectiveTwistStrength(settings.twist, audio.bass);
    u.uTwistPhase!.value = twistPhase(settings.twist, timeSec);
    u.uTwistAxis!.value = axisToInt(settings.twist.axis);
  }

  /**
   * Issue #36: サムネ生成時に uPixelRatio を一時的に縮小し、fn 実行後に
   * 元の値へ復元する。実画面 (大きい drawing buffer) 基準の uPixelRatio で
   * サムネ RT (小さい drawing buffer) に描くと粒子が過大になり白飛びするため。
   * fn が throw しても uniform は確実に戻す。
   */
  withRenderScale<T>(pixelRatio: number, fn: () => T): T {
    const u = this.material.uniforms;
    const saved = u.uPixelRatio!.value as number;
    u.uPixelRatio!.value = pixelRatio;
    try {
      return fn();
    } finally {
      u.uPixelRatio!.value = saved;
    }
  }
}
