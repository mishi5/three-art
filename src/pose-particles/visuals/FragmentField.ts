import * as THREE from "three";
import { NUM_JOINTS, type AudioFeatures, type Joints } from "../types";

const FRAGMENT_COUNT = 10000;
const FIELD_SIZE = 3.0; // メートル

const vertexShader = /* glsl */ `
  #define MAX_JOINTS 13

  uniform vec3 uJoints[MAX_JOINTS];
  uniform float uTime;
  uniform float uVolume;
  uniform float uMid;
  uniform float uPixelRatio;

  attribute vec3 aBasePosition;
  attribute float aSeed;

  varying float vAlpha;

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
    vec3 drift = curlNoise(base * 0.5 + uTime * 0.1) * (0.3 + uMid * 0.5);
    vec3 pos = base + drift;

    // 13 joints: inverse-square pull
    vec3 force = vec3(0.0);
    for (int i = 0; i < MAX_JOINTS; i++) {
      vec3 toJoint = uJoints[i] - pos;
      float d2 = dot(toJoint, toJoint) + 0.05;
      force += toJoint / d2;
    }
    pos += force * 0.02;

    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = (1.5 + uVolume * 1.5) * uPixelRatio * (1.0 / -mv.z);
    vAlpha = 0.4 + uVolume * 0.4;
  }
`;

const fragmentShader = /* glsl */ `
  precision mediump float;
  varying float vAlpha;

  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    float circle = 1.0 - smoothstep(0.35, 0.5, d);
    if (circle < 0.01) discard;
    gl_FragColor = vec4(vec3(0.85), circle * vAlpha);
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
        uTime: { value: 0 },
        uVolume: { value: 0 },
        uMid: { value: 0 },
        uPixelRatio: { value: pixelRatio },
      },
    });

    this.object3D = new THREE.Points(geom, this.material);
    this.object3D.frustumCulled = false;
  }

  update(joints: Joints, audio: AudioFeatures, timeSec: number): void {
    const u = this.material.uniforms;
    const arr = u.uJoints!.value as THREE.Vector3[];
    for (let i = 0; i < NUM_JOINTS; i++) {
      arr[i]!.set(joints[i * 3]!, joints[i * 3 + 1]!, joints[i * 3 + 2]!);
    }
    u.uTime!.value = timeSec;
    u.uVolume!.value = audio.volume;
    u.uMid!.value = audio.mid;
  }
}
