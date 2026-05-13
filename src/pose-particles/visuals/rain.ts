import * as THREE from "three";
import type { AudioFeatures } from "../types";
import type { Settings } from "../settings";

export function binIndexToX(binIndex: number, fftLen: number, areaWidth: number): number {
  if (fftLen <= 1) return 0;
  const u = binIndex / (fftLen - 1);
  return (u - 0.5) * areaWidth;
}

export function expectedRainSpeed(baseSpeed: number, ampGain: number, amp: number): number {
  return baseSpeed + ampGain * amp;
}

const VERTEX_SHADER = /* glsl */ `
  attribute float aXIndex;
  attribute float aSeed;
  attribute float aTip;

  uniform float uTime;
  uniform sampler2D uFft;
  uniform float uFftLen;
  uniform float uBaseSpeed;
  uniform float uAmpGain;
  uniform float uLength;
  uniform float uAreaWidth;
  uniform float uAreaHeight;

  varying float vSpeed;

  void main() {
    // bin index -> x position
    float xN = (uFftLen > 1.0) ? (aXIndex / (uFftLen - 1.0)) : 0.5;
    float x = (xN - 0.5) * uAreaWidth;

    // sample fft amplitude for this column (center of texel)
    float u = (aXIndex + 0.5) / uFftLen;
    float amp = texture2D(uFft, vec2(u, 0.5)).r;
    float v = uBaseSpeed + uAmpGain * amp;
    vSpeed = v;

    // per-particle Y0 offset so the ring buffer is staggered
    float y0 = (aSeed - 0.5) * uAreaHeight;
    float y = mod(y0 - v * uTime, uAreaHeight) - uAreaHeight * 0.5;

    // tip vertex (aTip=1) sits below head by length scaled by speed
    float lengthScale = clamp(v / max(uBaseSpeed + uAmpGain * 0.2, 0.001), 0.3, 6.0);
    y -= aTip * uLength * lengthScale;

    // small Z spread so the wall isn't pure flat
    float z = (fract(aSeed * 7.319) - 0.5) * 0.1;

    vec4 mv = modelViewMatrix * vec4(x, y, z, 1.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  precision highp float;
  uniform vec3 uColor;
  varying float vSpeed;
  void main() {
    // faster drops glow brighter
    float boost = clamp(vSpeed * 0.4, 0.2, 1.5);
    gl_FragColor = vec4(uColor * boost, 1.0);
  }
`;

export class RainField {
  readonly object3D: THREE.LineSegments;
  private material: THREE.ShaderMaterial;
  private fftTexture: THREE.DataTexture;
  private fftBuf: Float32Array<ArrayBuffer>;
  private currentCount = 0;
  private currentFftLen = 0;

  constructor() {
    const geom = new THREE.BufferGeometry();
    // dummy attribute required by Three.js
    geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(0), 3));
    geom.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 8);

    // 1x1 placeholder so the sampler binding is valid even before first audio frame.
    this.fftBuf = new Float32Array(new ArrayBuffer(4));
    this.fftTexture = new THREE.DataTexture(
      this.fftBuf, 1, 1, THREE.RedFormat, THREE.FloatType,
    );
    this.fftTexture.needsUpdate = true;

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime:        { value: 0 },
        uFft:         { value: this.fftTexture },
        uFftLen:      { value: 1 },
        uBaseSpeed:   { value: 0.3 },
        uAmpGain:     { value: 4.0 },
        uLength:      { value: 0.04 },
        uAreaWidth:   { value: 2.0 },
        uAreaHeight:  { value: 2.4 },
        uColor:       { value: new THREE.Color(0.6, 0.8, 1.0) },
      },
    });

    this.object3D = new THREE.LineSegments(geom, this.material);
    this.object3D.frustumCulled = false;
    this.object3D.renderOrder = 5;
    this.object3D.visible = false;
  }

  /** Build / rebuild particle attribute buffers for the requested count and fftLen. */
  private rebuild(count: number, fftLen: number): void {
    const N = Math.max(1, Math.floor(count));
    const L = Math.max(1, Math.floor(fftLen));

    const xIndex = new Float32Array(N * 2);
    const seed = new Float32Array(N * 2);
    const tip = new Float32Array(N * 2);
    const position = new Float32Array(N * 2 * 3);

    for (let i = 0; i < N; i++) {
      const bin = (i * L / N) % L;
      const s = (i * 2654435761) >>> 0;
      const seedVal = (s / 0xffffffff);
      const baseIdx = i * 2;
      // head vertex
      xIndex[baseIdx] = bin;
      seed[baseIdx] = seedVal;
      tip[baseIdx] = 0;
      // tip vertex
      xIndex[baseIdx + 1] = bin;
      seed[baseIdx + 1] = seedVal;
      tip[baseIdx + 1] = 1;
    }

    const geom = this.object3D.geometry as THREE.BufferGeometry;
    geom.deleteAttribute("position");
    geom.deleteAttribute("aXIndex");
    geom.deleteAttribute("aSeed");
    geom.deleteAttribute("aTip");
    geom.setAttribute("position", new THREE.BufferAttribute(position, 3));
    geom.setAttribute("aXIndex", new THREE.BufferAttribute(xIndex, 1));
    geom.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    geom.setAttribute("aTip", new THREE.BufferAttribute(tip, 1));
    geom.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 8);

    this.currentCount = N;
  }

  private rebuildFftTexture(fftLen: number): void {
    const L = Math.max(1, Math.floor(fftLen));
    this.fftTexture.dispose();
    this.fftBuf = new Float32Array(new ArrayBuffer(L * 4));
    this.fftTexture = new THREE.DataTexture(
      this.fftBuf, L, 1, THREE.RedFormat, THREE.FloatType,
    );
    this.fftTexture.needsUpdate = true;
    this.material.uniforms.uFft!.value = this.fftTexture;
    this.material.uniforms.uFftLen!.value = L;
    this.currentFftLen = L;
  }

  update(audio: AudioFeatures, settings: Settings, t: number): void {
    if (settings.mode !== "rain") {
      this.object3D.visible = false;
      return;
    }
    this.object3D.visible = true;

    const r = settings.rain;
    const desiredCount = Math.max(16, Math.floor(r.count));
    const fftLen = audio.fft.length > 0 ? audio.fft.length : 1;

    if (desiredCount !== this.currentCount || fftLen !== this.currentFftLen) {
      if (fftLen !== this.currentFftLen) this.rebuildFftTexture(fftLen);
      if (desiredCount !== this.currentCount) this.rebuild(desiredCount, this.currentFftLen);
    }

    // copy this frame's fft into the DataTexture
    if (audio.fft.length === this.currentFftLen) {
      this.fftBuf.set(audio.fft);
      this.fftTexture.needsUpdate = true;
    }

    const u = this.material.uniforms;
    u.uTime!.value = t;
    u.uBaseSpeed!.value = r.baseSpeed;
    u.uAmpGain!.value = r.ampGain;
    u.uLength!.value = r.length;
    u.uAreaWidth!.value = r.areaWidth;
    u.uAreaHeight!.value = r.areaHeight;
  }
}
