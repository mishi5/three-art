import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { type BlurSettings, MAX_BLUR_ITERATIONS, effectiveBlurStrength } from "./blur";

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

export class BlurPipeline {
  private composer: EffectComposer;
  private blurPairs: BlurPair[] = [];
  private texelW = 1;
  private texelH = 1;

  constructor(
    private renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
  ) {
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));

    for (let i = 0; i < MAX_BLUR_ITERATIONS; i++) {
      const horizontal = this.makeBlurPass(1, 0);
      const vertical = this.makeBlurPass(0, 1);
      horizontal.enabled = false;
      vertical.enabled = false;
      this.composer.addPass(horizontal);
      this.composer.addPass(vertical);
      this.blurPairs.push({ horizontal, vertical });
    }

    this.composer.addPass(new OutputPass());
  }

  private makeBlurPass(dx: number, dy: number): ShaderPass {
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

  setSize(w: number, h: number): void {
    this.composer.setSize(w, h);
    const dpr = this.renderer.getPixelRatio();
    this.texelW = 1.0 / Math.max(1, Math.floor(w * dpr));
    this.texelH = 1.0 / Math.max(1, Math.floor(h * dpr));
    for (const pair of this.blurPairs) {
      (pair.horizontal.uniforms.uTexel!.value as THREE.Vector2).set(this.texelW, this.texelH);
      (pair.vertical.uniforms.uTexel!.value as THREE.Vector2).set(this.texelW, this.texelH);
    }
  }

  update(b: BlurSettings, bass: number): void {
    const radius = effectiveBlurStrength(b, bass);
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

  render(): void {
    this.composer.render();
  }
}
