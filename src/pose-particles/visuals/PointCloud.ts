import * as THREE from "three";
import { NUM_JOINTS, type AudioFeatures, type Joints } from "../types";
import vertexShader from "./shaders/pointCloud.vert.glsl" with { type: "text" };
import fragmentShader from "./shaders/pointCloud.frag.glsl" with { type: "text" };

const POINTS_PER_JOINT = 400;
const SIGMA = 0.08; // メートル

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
    // dummy position attribute（Three.js は position を要求）
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

  update(joints: Joints, audio: AudioFeatures, timeSec: number): void {
    const u = this.material.uniforms;
    const arr = u.uJoints!.value as THREE.Vector3[];
    for (let i = 0; i < NUM_JOINTS; i++) {
      arr[i]!.set(joints[i * 3]!, joints[i * 3 + 1]!, joints[i * 3 + 2]!);
    }
    u.uTime!.value = timeSec;
    u.uVolume!.value = audio.volume;
    u.uBass!.value = audio.bass;
    u.uTreble!.value = audio.treble;
  }
}
