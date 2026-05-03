import * as THREE from "three";
import { NUM_JOINTS, type AudioFeatures, type Joints } from "../types";
import type { Settings } from "../settings";
import { axisToInt, effectiveTwistStrength, twistPhase } from "./twist";

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
  uniform float uOutlierThreshold;  // aSeed > this => outlier
  uniform float uOutlierBoost;      // multiplier applied to offsets / size on outliers
  uniform float uTwistStrength;     // 0 disables twist
  uniform float uTwistPhase;
  uniform float uTwistAxis;         // 0=x, 1=y, 2=z

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

  // Twist: rotate around the chosen axis by an angle proportional to the
  // coordinate value on that axis (plus a time-driven phase). Preserves the
  // axis-aligned coordinate, rotates the orthogonal pair in 2D.
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
      // x-axis: rotate (y,z)
      return vec3(p.x, p.y * c - p.z * sn, p.y * sn + p.z * c);
    } else if (axis < 1.5) {
      // y-axis: rotate (x,z)
      return vec3(p.x * c - p.z * sn, p.y, p.x * sn + p.z * c);
    }
    // z-axis: rotate (x,y)
    return vec3(p.x * c - p.y * sn, p.x * sn + p.y * c, p.z);
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

    // Outlier spike: ~uOutlierFraction of particles oscillate independently,
    // shooting outward and retracting at their own per-particle frequency.
    // Each picked particle pulses 1× → boost× → 1× over time, so the
    // silhouette grows and pulls back in trembling spikes rather than
    // looking like a static second shell.
    float outlierMask = smoothstep(uOutlierThreshold - 0.04, uOutlierThreshold, aSeed);
    float spikeFreq = 1.0 + aSeed * 4.0;       // 1..5 Hz, per-particle
    float spikePhase = aSeed * 217.13;         // de-sync phases
    float spikeWave = sin(uTime * spikeFreq + spikePhase) * 0.5 + 0.5;  // 0..1
    float outlier = 1.0 + outlierMask * (uOutlierBoost - 1.0) * spikeWave;

    float shimmerAmp = uTreble * uTrebleShimmer + uAmbientShimmer;
    float shimmer = sin(uTime * 30.0 + aSeed * 100.0) * shimmerAmp * outlier;

    if (uMode < 0.5) {
      // bones: per-joint gaussian cluster
      vec3 jointPos = selectJoint(jointIdx) - uCenter;
      vis = selectVisibility(jointIdx);
      float radius = 1.0 + uBass * uBassExpansion;
      vec3 offset = aOffset * radius * outlier;
      offset += normalize(aOffset + 0.0001) * shimmer;
      pos = jointPos + offset;
      float d = length(aOffset);
      float visGate = smoothstep(0.2, 0.6, vis);
      visAlpha = (1.0 - smoothstep(0.0, 0.15, d)) * visGate;
    } else if (uMode < 1.5) {
      // cube: particles uniformly on the SURFACE of a centred cube
      // Pick a face uniformly (6 faces) using a separate hash, then place
      // randomly on that face.
      float faceHash = fract(aSeed * 13.717 + aJointIndex * 0.41);
      vec3 r = hash3unit(aSeed * 7.0 + aJointIndex + 1.0);
      vec2 uv = (r.xy - 0.5) * 2.0;       // [-1, 1]^2
      vec3 cubePos;
      if (faceHash < 0.16667)      cubePos = vec3( 1.0, uv.x, uv.y);
      else if (faceHash < 0.33333) cubePos = vec3(-1.0, uv.x, uv.y);
      else if (faceHash < 0.50000) cubePos = vec3(uv.x,  1.0, uv.y);
      else if (faceHash < 0.66667) cubePos = vec3(uv.x, -1.0, uv.y);
      else if (faceHash < 0.83333) cubePos = vec3(uv.x, uv.y,  1.0);
      else                         cubePos = vec3(uv.x, uv.y, -1.0);
      float scale = uShapeRadius * (1.0 + uBass * uShapeBassPulse) * outlier;
      pos = cubePos * scale + normalize(cubePos + 0.0001) * shimmer;
      visAlpha = 0.85;
    } else {
      // sphere: particles uniformly on the SURFACE of a sphere
      vec3 r = hash3unit(aSeed * 7.0 + aJointIndex + 1.0);
      float theta = r.x * 6.2831853;
      float cosPhi = 2.0 * r.y - 1.0;
      float sinPhi = sqrt(max(0.0, 1.0 - cosPhi * cosPhi));
      vec3 dir = vec3(sinPhi * cos(theta), sinPhi * sin(theta), cosPhi);
      float radius = uShapeRadius * (1.0 + uBass * uShapeBassPulse) * outlier;
      pos = dir * radius + dir * shimmer;
      visAlpha = 0.85;
    }

    pos = applyTwist(pos, uTwistStrength, uTwistPhase, uTwistAxis);

    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = (uBaseSize + uVolume * uVolumeSize) * outlier * uPixelRatio * (1.0 / -mv.z);

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
        uOutlierThreshold: { value: 0.9 },
        uOutlierBoost: { value: 1.0 },
        uTwistStrength: { value: 0 },
        uTwistPhase: { value: 0 },
        uTwistAxis: { value: 1 },
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
    u.uOutlierThreshold!.value = 1.0 - Math.max(0, Math.min(1, settings.outlier.fraction));
    u.uOutlierBoost!.value = settings.outlier.boost;
    u.uTwistStrength!.value = effectiveTwistStrength(settings.twist, audio.bass);
    u.uTwistPhase!.value = twistPhase(settings.twist, timeSec);
    u.uTwistAxis!.value = axisToInt(settings.twist.axis);
  }
}
