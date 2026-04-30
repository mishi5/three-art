import * as THREE from "three";
import { NUM_JOINTS, type AudioFeatures, type Joints } from "../types";

const POINTS_PER_JOINT = 400;
const SIGMA = 0.08; // メートル

const vertexShader = /* glsl */ `
  #define MAX_JOINTS 13

  uniform vec3 uJoints[MAX_JOINTS];
  uniform float uVisibility[MAX_JOINTS];
  uniform float uTime;
  uniform float uVolume;
  uniform float uBass;
  uniform float uTreble;
  uniform float uPixelRatio;

  attribute float aJointIndex;
  attribute vec3 aOffset;
  attribute float aSeed;

  varying float vAlpha;

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
    vec3 jointPos = selectJoint(jointIdx);
    float vis = selectVisibility(jointIdx);

    float radius = 1.0 + uBass * 1.5;
    vec3 offset = aOffset * radius;

    float shimmer = sin(uTime * 30.0 + aSeed * 100.0) * uTreble * 0.02;
    offset += normalize(aOffset + 0.0001) * shimmer;

    vec3 pos = jointPos + offset;
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = (3.0 + uVolume * 5.0) * uPixelRatio * (1.0 / -mv.z);

    float d = length(aOffset);
    // smoothstep on visibility: full alpha above 0.5, fade below
    float visGate = smoothstep(0.2, 0.6, vis);
    vAlpha = (1.0 - smoothstep(0.0, 0.15, d)) * (0.5 + uTreble * 0.5) * visGate;
  }
`;

const fragmentShader = /* glsl */ `
  precision mediump float;
  varying float vAlpha;

  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    float circle = 1.0 - smoothstep(0.4, 0.5, d);
    if (circle < 0.01) discard;
    gl_FragColor = vec4(vec3(1.0), circle * vAlpha);
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
        uTime: { value: 0 },
        uVolume: { value: 0 },
        uBass: { value: 0 },
        uTreble: { value: 0 },
        uPixelRatio: { value: pixelRatio },
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

  update(joints: Joints, visibility: Float32Array, audio: AudioFeatures, timeSec: number): void {
    const u = this.material.uniforms;
    const arr = u.uJoints!.value as THREE.Vector3[];
    for (let i = 0; i < NUM_JOINTS; i++) {
      arr[i]!.set(joints[i * 3]!, joints[i * 3 + 1]!, joints[i * 3 + 2]!);
    }
    const vis = u.uVisibility!.value as number[];
    for (let i = 0; i < NUM_JOINTS; i++) {
      vis[i] = visibility[i] ?? 0;
    }
    u.uTime!.value = timeSec;
    u.uVolume!.value = audio.volume;
    u.uBass!.value = audio.bass;
    u.uTreble!.value = audio.treble;
  }
}
