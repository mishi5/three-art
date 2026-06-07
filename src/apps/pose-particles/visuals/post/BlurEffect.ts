import * as THREE from "three";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import type { PostEffect, SmoothedAudio } from "./PostEffect";
import type { Settings } from "../../settings";
import { MAX_BLUR_ITERATIONS, effectiveBlurStrength } from "../blur";

const blurFragment = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform vec2 uTexel;
  uniform vec2 uDirection;
  uniform float uRadius;
  varying vec2 vUv;

  void main() {
    vec2 stepv = uTexel * uDirection * uRadius;
    vec4 c = texture2D(tDiffuse, vUv) * 0.227027;
    c += texture2D(tDiffuse, vUv + stepv * 1.0) * 0.194595;
    c += texture2D(tDiffuse, vUv - stepv * 1.0) * 0.194595;
    c += texture2D(tDiffuse, vUv + stepv * 2.0) * 0.121622;
    c += texture2D(tDiffuse, vUv - stepv * 2.0) * 0.121622;
    c += texture2D(tDiffuse, vUv + stepv * 3.0) * 0.054054;
    c += texture2D(tDiffuse, vUv - stepv * 3.0) * 0.054054;
    c += texture2D(tDiffuse, vUv + stepv * 4.0) * 0.016216;
    c += texture2D(tDiffuse, vUv - stepv * 4.0) * 0.016216;
    gl_FragColor = c;
  }
`;

const blurVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

interface BlurPair {
  horizontal: ShaderPass;
  vertical: ShaderPass;
}

export class BlurEffect implements PostEffect {
  readonly id = "blur";
  readonly passes: ShaderPass[];
  private blurPairs: BlurPair[] = [];
  private texelW = 1;
  private texelH = 1;

  constructor() {
    const passes: ShaderPass[] = [];
    for (let i = 0; i < MAX_BLUR_ITERATIONS; i++) {
      const horizontal = makeBlurPass(1, 0);
      const vertical = makeBlurPass(0, 1);
      horizontal.enabled = false;
      vertical.enabled = false;
      passes.push(horizontal, vertical);
      this.blurPairs.push({ horizontal, vertical });
    }
    this.passes = passes;
  }

  setSize(w: number, h: number, dpr: number): void {
    this.texelW = 1.0 / Math.max(1, Math.floor(w * dpr));
    this.texelH = 1.0 / Math.max(1, Math.floor(h * dpr));
    for (const pair of this.blurPairs) {
      (pair.horizontal.uniforms.uTexel!.value as THREE.Vector2).set(this.texelW, this.texelH);
      (pair.vertical.uniforms.uTexel!.value as THREE.Vector2).set(this.texelW, this.texelH);
    }
  }

  update(settings: Settings, audio: SmoothedAudio): void {
    const b = settings.blur;
    const radius = effectiveBlurStrength(b, audio.bass);
    const active = radius > 0;
    const iterations = Math.max(1, Math.min(MAX_BLUR_ITERATIONS, Math.round(b.iterations)));
    for (let i = 0; i < this.blurPairs.length; i++) {
      const pair = this.blurPairs[i]!;
      const enabled = active && i < iterations;
      pair.horizontal.enabled = enabled;
      pair.vertical.enabled = enabled;
      pair.horizontal.uniforms.uRadius!.value = radius;
      pair.vertical.uniforms.uRadius!.value = radius;
    }
  }

  createPassesForTarget(
    targetW: number,
    targetH: number,
    fullSourceW: number,
  ): ShaderPass[] {
    const passes: ShaderPass[] = [];
    const texelW = 1 / Math.max(1, targetW);
    const texelH = 1 / Math.max(1, targetH);
    const scale = Math.max(1, targetW) / Math.max(1, fullSourceW);
    for (const pair of this.blurPairs) {
      if (!pair.horizontal.enabled) continue;
      const baseRadius = pair.horizontal.uniforms.uRadius!.value as number;
      if (baseRadius <= 0) continue;
      const radius = baseRadius * scale;
      const h = makeBlurPass(1, 0);
      const v = makeBlurPass(0, 1);
      (h.uniforms.uTexel!.value as THREE.Vector2).set(texelW, texelH);
      (v.uniforms.uTexel!.value as THREE.Vector2).set(texelW, texelH);
      h.uniforms.uRadius!.value = radius;
      v.uniforms.uRadius!.value = radius;
      passes.push(h, v);
    }
    return passes;
  }

  dispose(): void {
    for (const pair of this.blurPairs) {
      pair.horizontal.dispose?.();
      pair.vertical.dispose?.();
    }
  }
}

function makeBlurPass(dx: number, dy: number): ShaderPass {
  return new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      uTexel: { value: new THREE.Vector2(1, 1) },
      uDirection: { value: new THREE.Vector2(dx, dy) },
      uRadius: { value: 1.0 },
    },
    vertexShader: blurVertex,
    fragmentShader: blurFragment,
  });
}
