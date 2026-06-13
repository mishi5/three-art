import * as THREE from "three";
import type { NodeState, NodeTypeDef } from "../graph/node-type";
import { ShaderSurface, NDC_VERTEX, blackTexture } from "../graph/shader-surface";

// core/effects/KaleidoscopeEffect の GLSL を移植。
const FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform float uSegments;
uniform vec2 uCenter;
uniform float uRotation;
uniform float uAspect;
uniform float uMix;
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

class KaleidoState {
  readonly black = blackTexture();
  readonly surface: ShaderSurface;
  constructor() {
    this.surface = new ShaderSurface(new THREE.ShaderMaterial({
      vertexShader: NDC_VERTEX,
      fragmentShader: FRAG,
      uniforms: {
        tDiffuse: { value: this.black },
        uSegments: { value: 6 },
        uCenter: { value: new THREE.Vector2(0, 0) },
        uRotation: { value: 0 },
        uAspect: { value: 1 },
        uMix: { value: 1 },
      },
      depthTest: false, depthWrite: false,
    }));
  }
  dispose(): void { this.surface.dispose(); this.black.dispose(); }
}

/** 万華鏡（texture→texture）。 */
export const KaleidoscopeNode: NodeTypeDef = {
  type: "Kaleidoscope",
  category: "effect",
  isSink: true,
  inputs: [{ id: "in", label: "in", type: "texture" }],
  outputs: [{ id: "texture", label: "tex", type: "texture" }],
  params: [
    { id: "segments", label: "segments", kind: "int", default: 6, min: 2, max: 16, step: 1 },
    { id: "rotation", label: "rotation", kind: "number", default: 0, min: -3.14, max: 3.14, step: 0.01 },
    { id: "centerX", label: "centerX", kind: "number", default: 0, min: -0.5, max: 0.5, step: 0.01 },
    { id: "centerY", label: "centerY", kind: "number", default: 0, min: -0.5, max: 0.5, step: 0.01 },
    { id: "mix", label: "mix", kind: "number", default: 1, min: 0, max: 1, step: 0.01 },
  ],
  createState: () => new KaleidoState(),
  disposeState: (state: NodeState) => (state as KaleidoState).dispose(),
  evaluate(ctx) {
    const s = ctx.state as KaleidoState | undefined;
    const env = ctx.env;
    if (!s || !env) return {};
    const u = s.surface.material.uniforms;
    u.tDiffuse!.value = (ctx.input("in") as THREE.Texture | undefined) ?? s.black;
    u.uSegments!.value = Math.max(2, Math.round(Number(ctx.param("segments") ?? 6)));
    (u.uCenter!.value as THREE.Vector2).set(Number(ctx.param("centerX") ?? 0), Number(ctx.param("centerY") ?? 0));
    u.uRotation!.value = Number(ctx.param("rotation") ?? 0);
    u.uAspect!.value = env.renderer.domElement.width / Math.max(1, env.renderer.domElement.height);
    u.uMix!.value = Number(ctx.param("mix") ?? 1);
    return { texture: s.surface.render(env.renderer) };
  },
};
