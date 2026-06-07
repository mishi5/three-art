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
  uniform float uSegments;
  uniform vec2 uCenter;
  uniform float uRotation;
  uniform float uAspect;
  uniform float uMix;
  varying vec2 vUv;

  void main() {
    vec2 p = vUv - 0.5 - uCenter;
    p.x *= uAspect;
    float r = length(p);
    float theta = atan(p.y, p.x) + uRotation;
    float seg = 6.28318530718 / max(2.0, uSegments);
    float t = mod(theta, seg);
    if (t > seg * 0.5) t = seg - t;
    vec2 q = vec2(cos(t), sin(t)) * r;
    q.x /= max(0.0001, uAspect);
    q += 0.5 + uCenter;
    vec4 src = texture2D(tDiffuse, vUv);
    vec4 kal = texture2D(tDiffuse, clamp(q, 0.0, 1.0));
    gl_FragColor = mix(src, kal, uMix);
  }
`;

export class KaleidoscopeEffect implements PostEffect {
  static readonly FRAGMENT_SHADER = FRAGMENT;
  readonly id = "kaleidoscope";
  readonly passes: ShaderPass[];

  constructor() {
    const pass = makePass();
    pass.enabled = false;
    this.passes = [pass];
  }

  setSize(w: number, h: number, _dpr: number): void {
    this.passes[0]!.uniforms.uAspect!.value = w / Math.max(1, h);
  }

  update(settings: Settings, _audio: SmoothedAudio): void {
    const k = settings.post.kaleidoscope;
    const pass = this.passes[0]!;
    const active = k.enabled && k.mix > 0;
    pass.enabled = active;
    pass.uniforms.uSegments!.value = Math.max(2, Math.round(k.segments));
    (pass.uniforms.uCenter!.value as THREE.Vector2).set(k.centerX, k.centerY);
    pass.uniforms.uRotation!.value = k.rotation;
    pass.uniforms.uMix!.value = k.mix;
  }

  createPassesForTarget(targetW: number, targetH: number, _fullSourceW: number): ShaderPass[] {
    if (!this.passes[0]!.enabled) return [];
    const p = makePass();
    const src = this.passes[0]!.uniforms;
    p.uniforms.uSegments!.value = src.uSegments!.value;
    (p.uniforms.uCenter!.value as THREE.Vector2).copy(src.uCenter!.value as THREE.Vector2);
    p.uniforms.uRotation!.value = src.uRotation!.value;
    p.uniforms.uMix!.value = src.uMix!.value;
    p.uniforms.uAspect!.value = targetW / Math.max(1, targetH);
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
      uSegments: { value: 6 },
      uCenter: { value: new THREE.Vector2(0, 0) },
      uRotation: { value: 0 },
      uAspect: { value: 1 },
      uMix: { value: 1 },
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
  });
}
