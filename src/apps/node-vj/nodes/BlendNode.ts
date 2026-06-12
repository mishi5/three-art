import * as THREE from "three";
import type { NodeEnv, NodeState, NodeTypeDef } from "../graph/node-type";
import { BLEND_MODES, blendModeToFloat } from "./blend-logic";

// GLSL は ASCII のみ。mode 分岐は float uniform の if 連鎖（int uniform 分岐の罠回避）。
const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tA;
uniform sampler2D tB;
uniform float uMode;
uniform float uMix;
void main() {
  vec3 a = texture2D(tA, vUv).rgb;
  vec3 b = texture2D(tB, vUv).rgb;
  vec3 blended;
  if (uMode < 0.5) {
    blended = b;                                   // normal
  } else if (uMode < 1.5) {
    blended = min(a + b, vec3(1.0));               // add
  } else if (uMode < 2.5) {
    blended = a * b;                               // multiply
  } else {
    blended = 1.0 - (1.0 - a) * (1.0 - b);         // screen
  }
  gl_FragColor = vec4(mix(a, blended, clamp(uMix, 0.0, 1.0)), 1.0);
}
`;

/** 1x1 の黒テクスチャ（未接続入力のフォールバック）。 */
function blackTexture(): THREE.Texture {
  const tex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  tex.needsUpdate = true;
  return tex;
}

class BlendSurface {
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private rt = new THREE.WebGLRenderTarget(2, 2, { depthBuffer: false });
  readonly black = blackTexture();
  readonly material: THREE.ShaderMaterial;
  private mesh: THREE.Mesh;

  constructor() {
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        tA: { value: this.black },
        tB: { value: this.black },
        uMode: { value: 0 },
        uMix: { value: 1 },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.scene.add(this.mesh);
  }

  render(renderer: THREE.WebGLRenderer): THREE.Texture {
    const w = renderer.domElement.width;
    const h = renderer.domElement.height;
    if (this.rt.width !== w || this.rt.height !== h) this.rt.setSize(w, h);
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.rt);
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(prev);
    return this.rt.texture;
  }

  dispose(): void {
    this.rt.dispose();
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.black.dispose();
  }
}

/**
 * テクスチャ合成ノード（#85）。a/b を mode で合成し、mix=0 で a そのまま、
 * mix=1 で完全合成（出力 = lerp(a, blend(a,b), mix)）。未接続入力は黒。
 */
export const BlendNode: NodeTypeDef = {
  type: "Blend",
  category: "visual",
  isSink: true,
  inputs: [
    { id: "a", label: "a", type: "texture" },
    { id: "b", label: "b", type: "texture" },
  ],
  outputs: [{ id: "texture", label: "tex", type: "texture" }],
  params: [
    { id: "mode", label: "mode", kind: "enum", default: "add", options: [...BLEND_MODES] },
    { id: "mix", label: "mix", kind: "number", default: 1, min: 0, max: 1, step: 0.01 },
  ],
  createState: () => new BlendSurface(),
  disposeState: (state: NodeState) => (state as BlendSurface).dispose(),
  evaluate(ctx) {
    const s = ctx.state as BlendSurface | undefined;
    const env = ctx.env;
    if (!s || !env) return {};
    const u = s.material.uniforms;
    u.tA!.value = (ctx.input("a") as THREE.Texture | undefined) ?? s.black;
    u.tB!.value = (ctx.input("b") as THREE.Texture | undefined) ?? s.black;
    u.uMode!.value = blendModeToFloat(ctx.param("mode"));
    u.uMix!.value = Number(ctx.param("mix") ?? 1);
    const texture = s.render(env.renderer);
    return { texture };
  },
};
