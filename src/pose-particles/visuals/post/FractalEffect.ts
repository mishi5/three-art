import * as THREE from "three";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import type { PostEffect, SmoothedAudio } from "./PostEffect";
import type { Settings } from "../../settings";

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform float uIterations;
  uniform float uScale;
  uniform vec2 uCenter;
  uniform float uRotation;
  uniform float uFade;
  uniform float uMix;
  varying vec2 vUv;

  void main() {
    vec4 acc = vec4(0.0);
    float wsum = 0.0;
    vec2 c = 0.5 + uCenter;
    for (int i = 0; i < 6; i++) {
      if (float(i) >= uIterations) break;
      float k = pow(uScale, float(i));
      float rot = uRotation * float(i);
      float cs = cos(rot);
      float sn = sin(rot);
      vec2 d = vUv - c;
      vec2 r = vec2(d.x * cs - d.y * sn, d.x * sn + d.y * cs);
      vec2 q = r / max(0.0001, k) + c;
      float inside = step(0.0, q.x) * step(q.x, 1.0) * step(0.0, q.y) * step(q.y, 1.0);
      float depthFade = mix(1.0, 1.0 - float(i) / max(1.0, uIterations - 1.0), uFade);
      float w = depthFade * inside;
      acc += texture2D(tDiffuse, q) * w;
      wsum += w;
    }
    vec4 base = texture2D(tDiffuse, vUv);
    vec4 frac = (wsum > 0.0) ? acc / wsum : base;
    gl_FragColor = mix(base, frac, uMix);
  }
`;

export class FractalEffect implements PostEffect {
  static readonly FRAGMENT_SHADER = FRAGMENT;
  readonly id = "fractal";
  readonly passes: ShaderPass[];

  constructor() {
    const pass = makePass();
    pass.enabled = false;
    this.passes = [pass];
  }

  setSize(_w: number, _h: number, _dpr: number): void {
    // UV ベース処理のためサイズ依存無し
  }

  update(settings: Settings, _audio: SmoothedAudio): void {
    const f = settings.post.fractal;
    const pass = this.passes[0]!;
    const active = f.enabled && f.mix > 0;
    pass.enabled = active;
    pass.uniforms.uIterations!.value = Math.max(1, Math.min(6, Math.round(f.iterations)));
    pass.uniforms.uScale!.value = Math.max(0.0001, f.scale);
    (pass.uniforms.uCenter!.value as THREE.Vector2).set(f.centerX, f.centerY);
    pass.uniforms.uRotation!.value = f.rotation;
    pass.uniforms.uFade!.value = f.fade;
    pass.uniforms.uMix!.value = f.mix;
  }

  createPassesForTarget(_targetW: number, _targetH: number, _fullSourceW: number): ShaderPass[] {
    if (!this.passes[0]!.enabled) return [];
    const p = makePass();
    const src = this.passes[0]!.uniforms;
    p.uniforms.uIterations!.value = src.uIterations!.value;
    p.uniforms.uScale!.value = src.uScale!.value;
    (p.uniforms.uCenter!.value as THREE.Vector2).copy(src.uCenter!.value as THREE.Vector2);
    p.uniforms.uRotation!.value = src.uRotation!.value;
    p.uniforms.uFade!.value = src.uFade!.value;
    p.uniforms.uMix!.value = src.uMix!.value;
    return [p];
  }

  dispose(): void {
    this.passes[0]!.dispose?.();
  }
}

function makePass(): ShaderPass {
  return new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      uIterations: { value: 3 },
      uScale: { value: 0.7 },
      uCenter: { value: new THREE.Vector2(0, 0) },
      uRotation: { value: 0 },
      uFade: { value: 0.3 },
      uMix: { value: 1 },
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
  });
}
