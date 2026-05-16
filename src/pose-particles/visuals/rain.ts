import * as THREE from "three";
import type { AudioFeatures } from "../types";
import type { RainBinMapping, Settings } from "../settings";

export function expectedRainSpeed(baseSpeed: number, ampGain: number, amp: number): number {
  return baseSpeed + ampGain * amp;
}

/**
 * 画面X位置 (粒子スロット i/N) を参照すべき FFT bin に変換する。
 * log は低域を画面の大半に割り当てる (pow(L, frac)-1)。
 */
export function mapBinIndex(
  i: number,
  n: number,
  fftLen: number,
  mapping: RainBinMapping,
): number {
  const L = Math.floor(fftLen);
  if (L <= 1 || n <= 1) return 0;
  const frac = i / (n - 1);
  const bin = mapping === "log" ? Math.pow(L, frac) - 1 : frac * (L - 1);
  return Math.max(0, Math.min(L - 1, Math.round(bin)));
}

/**
 * 粒子が生成 (上端リスポーン) された瞬間に確定する落下速度。
 * jitter01 (0..1) で ±15% の個体差を付け、無音時も等速格子に見えないようにする。
 */
export function pickSpawnSpeed(
  baseSpeed: number,
  ampGain: number,
  amp: number,
  jitter01: number,
): number {
  const factor = 0.85 + 0.3 * jitter01;
  return (baseSpeed + ampGain * amp) * factor;
}

/**
 * 粒子の頭 Y を 1 フレーム分落下させる。領域は [-areaHeight/2, +areaHeight/2]。
 * 下端を越えたら上側へラップし respawned=true を返す (呼び側で速度を再確定)。
 * 速度は粒子ごとに保持され、落下中は変化しない (生成時の速度を維持)。
 */
export function advanceParticleY(
  y: number,
  speed: number,
  dt: number,
  areaHeight: number,
): { y: number; respawned: boolean } {
  if (areaHeight <= 0) return { y: 0, respawned: false };
  const half = areaHeight * 0.5;
  const pos = y + half; // [0, areaHeight)
  const next = pos - speed * dt;
  const respawned = next < 0;
  const wrapped = ((next % areaHeight) + areaHeight) % areaHeight;
  return { y: wrapped - half, respawned };
}

/** Reproducible per-particle RNG. */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const VERTEX_SHADER = /* glsl */ `
  attribute float aSpeed;
  uniform float uSpeedRef;
  varying float vBoost;
  void main() {
    // faster drops glow brighter, normalised against a reference speed
    vBoost = clamp(0.3 + (aSpeed / max(uSpeedRef, 0.001)) * 0.7, 0.3, 1.6);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  precision highp float;
  uniform vec3 uColor;
  varying float vBoost;
  void main() {
    gl_FragColor = vec4(uColor * vBoost, 1.0);
  }
`;

export class RainField {
  readonly object3D: THREE.LineSegments;
  private material: THREE.ShaderMaterial;

  // Per-particle persistent state (length = count).
  private pBin = new Int32Array(0);
  private pX = new Float32Array(0);
  private pZ = new Float32Array(0);
  private pY = new Float32Array(0);
  private pSpeed = new Float32Array(0);
  private pSpeedJitter = new Float32Array(0);
  private pLen = new Float32Array(0);

  // GPU buffers (2 vertices per particle: head + tail).
  private posAttr: THREE.BufferAttribute;
  private speedAttr: THREE.BufferAttribute;
  private positions = new Float32Array(0);
  private speeds = new Float32Array(0);

  private currentCount = 0;
  private currentFftLen = 0;
  private currentMapping: RainBinMapping = "linear";
  private currentAreaWidth = 0;
  private currentAreaHeight = 0;
  private lastT: number | null = null;

  constructor() {
    const geom = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.positions, 3);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.speedAttr = new THREE.BufferAttribute(this.speeds, 1);
    this.speedAttr.setUsage(THREE.DynamicDrawUsage);
    geom.setAttribute("position", this.posAttr);
    geom.setAttribute("aSpeed", this.speedAttr);
    geom.setDrawRange(0, 0);
    geom.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 8);

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uColor:    { value: new THREE.Color(0.6, 0.8, 1.0) },
        uSpeedRef: { value: 1.0 },
      },
    });

    this.object3D = new THREE.LineSegments(geom, this.material);
    this.object3D.frustumCulled = false;
    this.object3D.renderOrder = 5;
    this.object3D.visible = false;
  }

  /** (Re)allocate per-particle state and GPU buffers. */
  private rebuild(
    count: number,
    fftLen: number,
    mapping: RainBinMapping,
    areaWidth: number,
    areaHeight: number,
  ): void {
    const N = Math.max(1, Math.floor(count));
    const L = Math.max(1, Math.floor(fftLen));
    const rng = mulberry32(0x9e3779b1 ^ N);

    this.pBin = new Int32Array(N);
    this.pX = new Float32Array(N);
    this.pZ = new Float32Array(N);
    this.pY = new Float32Array(N);
    this.pSpeed = new Float32Array(N);
    this.pSpeedJitter = new Float32Array(N);
    this.pLen = new Float32Array(N);
    this.positions = new Float32Array(N * 2 * 3);
    this.speeds = new Float32Array(N * 2);

    const cellW = N > 1 ? areaWidth / N : areaWidth;
    for (let i = 0; i < N; i++) {
      const screenFrac = N > 1 ? i / (N - 1) : 0.5;
      // uniform slot + jitter so it's not a rigid lattice
      const x = (screenFrac - 0.5) * areaWidth + (rng() - 0.5) * cellW * 2.0;
      this.pBin[i] = mapBinIndex(i, N, L, mapping);
      this.pX[i] = x;
      this.pZ[i] = (rng() - 0.5) * 0.1;
      // random initial Y phase so drops don't all share a row
      this.pY[i] = (rng() - 0.5) * areaHeight;
      this.pSpeedJitter[i] = rng();
      this.pSpeed[i] = 0; // set on first respawn / seeded below
      this.pLen[i] = 0.8 + rng() * 0.4; // per-particle length variance
    }

    const geom = this.object3D.geometry as THREE.BufferGeometry;
    this.posAttr = new THREE.BufferAttribute(this.positions, 3);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.speedAttr = new THREE.BufferAttribute(this.speeds, 1);
    this.speedAttr.setUsage(THREE.DynamicDrawUsage);
    geom.setAttribute("position", this.posAttr);
    geom.setAttribute("aSpeed", this.speedAttr);
    geom.setDrawRange(0, N * 2);
    geom.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 8);

    this.currentCount = N;
    this.currentFftLen = L;
    this.currentMapping = mapping;
    this.currentAreaWidth = areaWidth;
    this.currentAreaHeight = areaHeight;
  }

  update(audio: AudioFeatures, settings: Settings, t: number): void {
    if (settings.mode !== "rain") {
      this.object3D.visible = false;
      this.lastT = null; // re-seed dt when we return to rain
      return;
    }
    this.object3D.visible = true;

    const r = settings.rain;
    const desiredCount = Math.max(16, Math.floor(r.count));
    const fftLen = audio.fft.length > 0 ? audio.fft.length : 1;

    if (
      desiredCount !== this.currentCount ||
      fftLen !== this.currentFftLen ||
      r.binMapping !== this.currentMapping ||
      r.areaWidth !== this.currentAreaWidth ||
      r.areaHeight !== this.currentAreaHeight
    ) {
      this.rebuild(desiredCount, fftLen, r.binMapping, r.areaWidth, r.areaHeight);
      // seed every particle's speed once so they don't start frozen
      for (let i = 0; i < this.currentCount; i++) {
        const bin = this.pBin[i] ?? 0;
        const amp = audio.fft.length === fftLen ? (audio.fft[bin] ?? 0) : 0;
        this.pSpeed[i] = pickSpawnSpeed(r.baseSpeed, r.ampGain, amp, this.pSpeedJitter[i] ?? 0.5);
      }
    }

    // dt clamped so first frame / tab-resume doesn't jump.
    const dt = this.lastT === null ? 0 : Math.min(Math.max(t - this.lastT, 0), 0.05);
    this.lastT = t;

    const N = this.currentCount;
    const H = r.areaHeight;
    const hasFft = audio.fft.length === this.currentFftLen;
    let maxSpeed = 0.0001;
    for (let i = 0; i < N; i++) {
      const adv = advanceParticleY(this.pY[i] ?? 0, this.pSpeed[i] ?? 0, dt, H);
      this.pY[i] = adv.y;
      if (adv.respawned) {
        const bin = this.pBin[i] ?? 0;
        const amp = hasFft ? (audio.fft[bin] ?? 0) : 0;
        this.pSpeed[i] = pickSpawnSpeed(r.baseSpeed, r.ampGain, amp, this.pSpeedJitter[i] ?? 0.5);
      }
      const sp = this.pSpeed[i] ?? 0;
      if (sp > maxSpeed) maxSpeed = sp;

      const x = this.pX[i] ?? 0;
      const z = this.pZ[i] ?? 0;
      const yHead = this.pY[i] ?? 0;
      const yTail = yHead + r.length * (this.pLen[i] ?? 1);
      const o = i * 6;
      this.positions[o + 0] = x;
      this.positions[o + 1] = yHead;
      this.positions[o + 2] = z;
      this.positions[o + 3] = x;
      this.positions[o + 4] = yTail;
      this.positions[o + 5] = z;
      this.speeds[i * 2] = sp;
      this.speeds[i * 2 + 1] = sp;
    }
    this.posAttr.needsUpdate = true;
    this.speedAttr.needsUpdate = true;
    this.material.uniforms.uSpeedRef!.value = maxSpeed;
  }
}
