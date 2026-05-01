import * as THREE from "three";
import { NUM_JOINTS, type AudioFeatures, type Joints } from "../types";
import type { Settings } from "../settings";

const POINTS_PER_JOINT = 400;
const SIGMA = 0.08; // メートル

const vertexShader = /* glsl */ `
  #define MAX_JOINTS 13

  uniform vec3 uJoints[MAX_JOINTS];
  uniform float uVisibility[MAX_JOINTS];
  uniform vec3 uCenter;
  uniform float uTime;
  uniform float uVolume;
  uniform float uBass;
  uniform float uTreble;
  uniform float uPixelRatio;
  uniform float uBassExpansion;
  uniform float uTrebleShimmer;
  uniform float uAmbientShimmer;
  uniform float uBaseSize;
  uniform float uVolumeSize;
  uniform float uMode;          // 0=bones, 1=cube, 2=sphere (float for WebGL1 portability)
  uniform float uShapeRadius;
  uniform float uShapeBassPulse;
  uniform float uHueBase;
  uniform float uHueSpread;
  uniform float uBassHueShift;
  uniform float uSaturation;
  uniform float uTrebleBoost;

  attribute float aJointIndex;
  attribute vec3 aOffset;
  attribute float aSeed;

  varying float vAlpha;
  varying vec3 vColor;

  vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }

  vec3 hash3unit(float seed) {
    return vec3(
      fract(sin(seed * 12.9898) * 43758.5453),
      fract(sin(seed * 78.2330) * 12345.6789),
      fract(sin(seed * 39.3460) * 98765.4321)
    );
  }

  vec3 selectJoint(int jointIdx) {
    if (jointIdx == 0)  return uJoints[0];
    if (jointIdx == 1)  return uJoints[1];
    if (jointIdx == 2)  return uJoints[2];
    if (jointIdx == 3)  return uJoints[3];
    if (jointIdx == 4)  return uJoints[4];
    if (jointIdx == 5)  return uJoints[5];
    if (jointIdx == 6)  return uJoints[6];
    if (jointIdx == 7)  return uJoints[7];
    if (jointIdx == 8)  return uJoints[8];
    if (jointIdx == 9)  return uJoints[9];
    if (jointIdx == 10) return uJoints[10];
    if (jointIdx == 11) return uJoints[11];
    return uJoints[12];
  }

  float selectVisibility(int jointIdx) {
    if (jointIdx == 0)  return uVisibility[0];
    if (jointIdx == 1)  return uVisibility[1];
    if (jointIdx == 2)  return uVisibility[2];
    if (jointIdx == 3)  return uVisibility[3];
    if (jointIdx == 4)  return uVisibility[4];
    if (jointIdx == 5)  return uVisibility[5];
    if (jointIdx == 6)  return uVisibility[6];
    if (jointIdx == 7)  return uVisibility[7];
    if (jointIdx == 8)  return uVisibility[8];
    if (jointIdx == 9)  return uVisibility[9];
    if (jointIdx == 10) return uVisibility[10];
    if (jointIdx == 11) return uVisibility[11];
    return uVisibility[12];
  }

  void main() {
    int jointIdx = int(aJointIndex + 0.5);
    vec3 pos;
    float vis;
    float visAlpha;

    float shimmerAmp = uTreble * uTrebleShimmer + uAmbientShimmer;
    float shimmer = sin(uTime * 30.0 + aSeed * 100.0) * shimmerAmp;

    if (uMode < 0.5) {
      // bones: per-joint gaussian cluster
      vec3 jointPos = selectJoint(jointIdx) - uCenter;
      vis = selectVisibility(jointIdx);
      float radius = 1.0 + uBass * uBassExpansion;
      vec3 offset = aOffset * radius;
      offset += normalize(aOffset + 0.0001) * shimmer;
      pos = jointPos + offset;
      float d = length(aOffset);
      float visGate = smoothstep(0.2, 0.6, vis);
      visAlpha = (1.0 - smoothstep(0.0, 0.15, d)) * visGate;
    } else if (uMode < 1.5) {
      // cube: uniform fill of a centred cube
      vec3 r = hash3unit(aSeed * 7.0 + aJointIndex + 1.0);
      vec3 cubePos = (r - 0.5) * 2.0 * uShapeRadius * (1.0 + uBass * uShapeBassPulse);
      cubePos += normalize(r - 0.5 + 0.0001) * shimmer;
      pos = cubePos;
      visAlpha = 0.7;
    } else {
      // sphere: uniformly distributed within a sphere
      vec3 r = hash3unit(aSeed * 7.0 + aJointIndex + 1.0);
      float theta = r.x * 6.2831853;
      float cosPhi = 2.0 * r.y - 1.0;
      float sinPhi = sqrt(max(0.0, 1.0 - cosPhi * cosPhi));
      float radius = pow(r.z, 1.0 / 3.0) * uShapeRadius * (1.0 + uBass * uShapeBassPulse);
      vec3 dir = vec3(sinPhi * cos(theta), sinPhi * sin(theta), cosPhi);
      pos = dir * radius + dir * shimmer;
      visAlpha = 0.7;
    }

    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = (uBaseSize + uVolume * uVolumeSize) * uPixelRatio * (1.0 / -mv.z);

    // Per-particle colour (HSV).
    float hue = fract(uHueBase + (aSeed - 0.5) * uHueSpread + uBass * uBassHueShift);
    float bright = 1.0 + uTreble * uTrebleBoost;
    vColor = hsv2rgb(vec3(hue, uSaturation, bright));
    // Treble drives a small alpha boost on top of the layout-derived alpha.
    vAlpha = visAlpha * (0.5 + uTreble * 0.5);
  }
`;

const fragmentShader = /* glsl */ `
  precision mediump float;
  varying float vAlpha;
  varying vec3 vColor;

  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    float circle = 1.0 - smoothstep(0.4, 0.5, d);
    if (circle < 0.01) discard;
    gl_FragColor = vec4(vColor, circle * vAlpha);
  }
`;

function gaussian(): number {
  // Box–Muller
  const u = 1 - Math.random();
  const v = 1 - Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export class PointCloud {
  readonly object3D: THREE.Points;
  private material: THREE.ShaderMaterial;
  private jointsUniform: Float32Array; // length 39

  constructor(pixelRatio: number) {
    const total = NUM_JOINTS * POINTS_PER_JOINT;
    const geom = new THREE.BufferGeometry();

    const offsets = new Float32Array(total * 3);
    const indices = new Float32Array(total);
    const seeds = new Float32Array(total);
    for (let j = 0; j < NUM_JOINTS; j++) {
      for (let p = 0; p < POINTS_PER_JOINT; p++) {
        const i = j * POINTS_PER_JOINT + p;
        offsets[i * 3 + 0] = gaussian() * SIGMA;
        offsets[i * 3 + 1] = gaussian() * SIGMA;
        offsets[i * 3 + 2] = gaussian() * SIGMA;
        indices[i] = j;
        seeds[i] = Math.random();
      }
    }
    geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(total * 3), 3));
    geom.setAttribute("aOffset", new THREE.BufferAttribute(offsets, 3));
    geom.setAttribute("aJointIndex", new THREE.BufferAttribute(indices, 1));
    geom.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
    geom.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 4);

    this.jointsUniform = new Float32Array(NUM_JOINTS * 3);

    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uJoints: { value: this.toVec3Array(this.jointsUniform) },
        uVisibility: { value: new Array(NUM_JOINTS).fill(0) },
        uCenter: { value: new THREE.Vector3() },
        uTime: { value: 0 },
        uVolume: { value: 0 },
        uBass: { value: 0 },
        uTreble: { value: 0 },
        uPixelRatio: { value: pixelRatio },
        uBassExpansion: { value: 1.5 },
        uTrebleShimmer: { value: 0.02 },
        uAmbientShimmer: { value: 0.0 },
        uBaseSize: { value: 3.0 },
        uVolumeSize: { value: 5.0 },
        uMode: { value: 0.0 },
        uShapeRadius: { value: 1.0 },
        uShapeBassPulse: { value: 0.5 },
        uHueBase: { value: 0.6 },
        uHueSpread: { value: 0.0 },
        uBassHueShift: { value: 0.0 },
        uSaturation: { value: 0.0 },
        uTrebleBoost: { value: 0.3 },
      },
    });

    this.object3D = new THREE.Points(geom, this.material);
    this.object3D.frustumCulled = false;
  }

  private toVec3Array(flat: Float32Array): THREE.Vector3[] {
    const arr: THREE.Vector3[] = [];
    for (let i = 0; i < NUM_JOINTS; i++) {
      arr.push(new THREE.Vector3(flat[i * 3]!, flat[i * 3 + 1]!, flat[i * 3 + 2]!));
    }
    return arr;
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
    u.uBass!.value = audio.bass;
    u.uTreble!.value = audio.treble;
    u.uBassExpansion!.value = settings.pointCloud.bassExpansion;
    u.uTrebleShimmer!.value = settings.pointCloud.trebleShimmer;
    u.uAmbientShimmer!.value = settings.pointCloud.ambientShimmer;
    u.uBaseSize!.value = settings.pointCloud.baseSize;
    u.uVolumeSize!.value = settings.pointCloud.volumeSize;
    u.uMode!.value = settings.mode === "bones" ? 0.0 : settings.mode === "cube" ? 1.0 : 2.0;
    u.uShapeRadius!.value = settings.shape.radius;
    u.uShapeBassPulse!.value = settings.shape.bassPulse;
    u.uHueBase!.value = settings.color.hueBase;
    u.uHueSpread!.value = settings.color.hueSpread;
    u.uBassHueShift!.value = settings.color.bassHueShift;
    u.uSaturation!.value = settings.color.saturation;
    u.uTrebleBoost!.value = settings.color.trebleBoost;
  }
}
