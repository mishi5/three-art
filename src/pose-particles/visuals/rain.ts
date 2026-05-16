import * as THREE from "three";
import type { AudioFeatures } from "../types";
import type { RainBinMapping, Settings } from "../settings";

export function expectedRainSpeed(baseSpeed: number, ampGain: number, amp: number): number {
  return baseSpeed + ampGain * amp;
}

/**
 * 画面X位置 (粒子スロット i/N) を参照すべき FFT bin に変換する。
 *
 * - linear: bin を画面に一様展開（高域の無音帯が画面の大半を占めてしまう）
 * - log: 低域を画面の大半に割り当てる。pow(L, frac)-1 で frac=0→0, frac=1→L-1。
 *        frac=0.5, L=1024 で bin≈31 となり、音楽エネルギーの集中する低域が
 *        画面左半分を占有する。
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
  let bin: number;
  if (mapping === "log") {
    bin = Math.pow(L, frac) - 1;
  } else {
    bin = frac * (L - 1);
  }
  return Math.max(0, Math.min(L - 1, Math.round(bin)));
}

/**
 * bin ごとの落下変位を 1 フレーム分だけ前進させ、areaHeight でラップする。
 *
 * 位置を `v * 経過時間` で計算すると、v が音量で毎フレーム変動する場合に
 * 移動量が ∫v dt ではなく v(t)*t になり、巨大な経過時間に Δv が乗って
 * 雨粒が瞬間移動する（速すぎる/カオスに見える）。変位を毎フレーム
 * `+= v*dt` で累積し H でラップすることで、v がどう変わっても連続な
 * 落下になり、かつ値が増え続けて float 精度が落ちることもない。
 */
export function stepDisplacement(
  prev: number,
  speed: number,
  dt: number,
  areaHeight: number,
): number {
  if (areaHeight <= 0) return 0;
  const next = prev + speed * dt;
  return ((next % areaHeight) + areaHeight) % areaHeight;
}

const VERTEX_SHADER = /* glsl */ `
  attribute float aXPos;
  attribute float aBin;
  attribute float aSeed;
  attribute float aTip;

  uniform sampler2D uData;
  uniform float uFftLen;
  uniform float uLength;
  uniform float uAreaWidth;
  uniform float uAreaHeight;

  varying float vSpeed;

  void main() {
    // screen X is uniform over particle slots; frequency mapping already
    // baked into aBin on the CPU side.
    float x = (aXPos - 0.5) * uAreaWidth;

    // uData.r = accumulated fall displacement (already wrapped on CPU),
    // uData.g = current fall speed (for brightness / length).
    float u = (aBin + 0.5) / uFftLen;
    vec2 d = texture2D(uData, vec2(u, 0.5)).rg;
    float disp = d.r;
    float v = d.g;
    vSpeed = v;

    // per-particle Y0 offset so the column is staggered, then subtract the
    // accumulated displacement. Continuous regardless of how v varies.
    float y0 = (aSeed - 0.5) * uAreaHeight;
    float y = mod(y0 - disp, uAreaHeight) - uAreaHeight * 0.5;

    // tip vertex (aTip=1) trails above the head; faster drops streak longer
    // but slow drops keep a visible minimum length (not a dot).
    float lengthScale = clamp(0.5 + v * 2.0, 0.6, 5.0);
    y += aTip * uLength * lengthScale;

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
    float boost = clamp(0.25 + vSpeed * 0.5, 0.25, 1.5);
    gl_FragColor = vec4(uColor * boost, 1.0);
  }
`;

export class RainField {
  readonly object3D: THREE.LineSegments;
  private material: THREE.ShaderMaterial;
  private dataTexture: THREE.DataTexture;
  /** Interleaved RG per bin: [disp0, speed0, disp1, speed1, ...]. */
  private dataBuf: Float32Array<ArrayBuffer>;
  /** Per-bin accumulated (wrapped) fall displacement. */
  private disp: Float32Array;
  private currentCount = 0;
  private currentFftLen = 0;
  private currentMapping: RainBinMapping = "linear";
  private lastT: number | null = null;

  constructor() {
    const geom = new THREE.BufferGeometry();
    // dummy attribute required by Three.js
    geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(0), 3));
    geom.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 8);

    // 1x1 RG placeholder so the sampler binding is valid before first frame.
    this.dataBuf = new Float32Array(new ArrayBuffer(2 * 4));
    this.disp = new Float32Array(1);
    this.dataTexture = new THREE.DataTexture(
      this.dataBuf, 1, 1, THREE.RGFormat, THREE.FloatType,
    );
    this.dataTexture.needsUpdate = true;

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uData:        { value: this.dataTexture },
        uFftLen:      { value: 1 },
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

  /** Build / rebuild particle attribute buffers. */
  private rebuild(count: number, fftLen: number, mapping: RainBinMapping): void {
    const N = Math.max(1, Math.floor(count));
    const L = Math.max(1, Math.floor(fftLen));

    const xPos = new Float32Array(N * 2);
    const bin = new Float32Array(N * 2);
    const seed = new Float32Array(N * 2);
    const tip = new Float32Array(N * 2);
    const position = new Float32Array(N * 2 * 3);

    for (let i = 0; i < N; i++) {
      const screenX = N > 1 ? i / (N - 1) : 0.5;
      const b = mapBinIndex(i, N, L, mapping);
      const s = (i * 2654435761) >>> 0;
      const seedVal = s / 0xffffffff;
      const baseIdx = i * 2;
      // head vertex
      xPos[baseIdx] = screenX;
      bin[baseIdx] = b;
      seed[baseIdx] = seedVal;
      tip[baseIdx] = 0;
      // tip vertex
      xPos[baseIdx + 1] = screenX;
      bin[baseIdx + 1] = b;
      seed[baseIdx + 1] = seedVal;
      tip[baseIdx + 1] = 1;
    }

    const geom = this.object3D.geometry as THREE.BufferGeometry;
    geom.deleteAttribute("position");
    geom.deleteAttribute("aXPos");
    geom.deleteAttribute("aBin");
    geom.deleteAttribute("aSeed");
    geom.deleteAttribute("aTip");
    geom.setAttribute("position", new THREE.BufferAttribute(position, 3));
    geom.setAttribute("aXPos", new THREE.BufferAttribute(xPos, 1));
    geom.setAttribute("aBin", new THREE.BufferAttribute(bin, 1));
    geom.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    geom.setAttribute("aTip", new THREE.BufferAttribute(tip, 1));
    geom.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 8);

    this.currentCount = N;
    this.currentMapping = mapping;
  }

  private rebuildDataTexture(fftLen: number): void {
    const L = Math.max(1, Math.floor(fftLen));
    this.dataTexture.dispose();
    this.dataBuf = new Float32Array(new ArrayBuffer(2 * L * 4));
    this.disp = new Float32Array(L);
    this.dataTexture = new THREE.DataTexture(
      this.dataBuf, L, 1, THREE.RGFormat, THREE.FloatType,
    );
    this.dataTexture.needsUpdate = true;
    this.material.uniforms.uData!.value = this.dataTexture;
    this.material.uniforms.uFftLen!.value = L;
    this.currentFftLen = L;
  }

  update(audio: AudioFeatures, settings: Settings, t: number): void {
    if (settings.mode !== "rain") {
      this.object3D.visible = false;
      this.lastT = null; // re-seed dt when we come back to rain
      return;
    }
    this.object3D.visible = true;

    const r = settings.rain;
    const desiredCount = Math.max(16, Math.floor(r.count));
    const fftLen = audio.fft.length > 0 ? audio.fft.length : 1;

    if (fftLen !== this.currentFftLen) this.rebuildDataTexture(fftLen);
    if (desiredCount !== this.currentCount || r.binMapping !== this.currentMapping) {
      this.rebuild(desiredCount, this.currentFftLen, r.binMapping);
    }

    // dt clamped so the first frame / tab-resume doesn't produce a huge jump.
    const dt = this.lastT === null ? 0 : Math.min(Math.max(t - this.lastT, 0), 0.05);
    this.lastT = t;

    const L = this.currentFftLen;
    const hasFft = audio.fft.length === L;
    for (let b = 0; b < L; b++) {
      const amp = hasFft ? (audio.fft[b] ?? 0) : 0;
      const v = expectedRainSpeed(r.baseSpeed, r.ampGain, amp);
      const d = stepDisplacement(this.disp[b] ?? 0, v, dt, r.areaHeight);
      this.disp[b] = d;
      this.dataBuf[b * 2] = d;
      this.dataBuf[b * 2 + 1] = v;
    }
    this.dataTexture.needsUpdate = true;

    const u = this.material.uniforms;
    u.uLength!.value = r.length;
    u.uAreaWidth!.value = r.areaWidth;
    u.uAreaHeight!.value = r.areaHeight;
  }
}
