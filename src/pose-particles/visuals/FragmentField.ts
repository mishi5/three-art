import * as THREE from "three";
import { NUM_JOINTS, type AudioFeatures, type Joints } from "../types";
import vertexShader from "./shaders/fragmentField.vert.glsl" with { type: "text" };
import fragmentShader from "./shaders/fragmentField.frag.glsl" with { type: "text" };

const FRAGMENT_COUNT = 10000;
const FIELD_SIZE = 3.0; // メートル

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
