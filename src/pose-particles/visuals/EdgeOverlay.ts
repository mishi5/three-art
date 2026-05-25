import * as THREE from "three";
import { NUM_JOINTS, type AudioFeatures, type Joints } from "../types";
import type { Settings } from "../settings";
import { applyTwist, effectiveTwistStrength, twistPhase } from "./twist";
import { noise3D } from "./value-noise";
import { samplePolyhedronUnit } from "./polyhedron-anchors";

const MAX_ANCHORS = 256;
const MAX_K = 5;
const MAX_SUBDIVISIONS = 16;
/** 同時に存在しうる最大エッジ数。リワイヤのフェード中は旧+新が並列するため 2x。 */
const MAX_EDGES = MAX_ANCHORS * MAX_K * 2;
/** サブセグメント = エッジ × 分割数。 */
const MAX_SUB_SEGMENTS = MAX_EDGES * MAX_SUBDIVISIONS;

/** fade state 値: 0=in (新規, alpha 0→1), 1=stable (alpha=1), 2=out (alpha 1→0)。 */
const STATE_IN = 0 as const;
const STATE_STABLE = 1 as const;
const STATE_OUT = 2 as const;

/** Lightweight RNG so the anchor set is reproducible. */
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

function gaussian(rng: () => number): number {
  // Box–Muller
  const u = 1 - rng();
  const v = 1 - rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** unique key for an undirected (a, b) pair. */
function edgeKey(a: number, b: number): number {
  return a < b ? a * MAX_ANCHORS + b : b * MAX_ANCHORS + a;
}

/**
 * Draws edges between a fixed set of anchor points that move with the body /
 * shape. Each anchor mirrors a particle in spirit (bones cluster, cube face,
 * sphere surface) but is its own independent point so we don't have to read
 * back the PointCloud's GPU buffer every frame.
 *
 * Anchor count and edge connectivity are tunable from the GUI.
 *
 * Issue #31: 揺らぎオプションを追加。
 *   - wave: 各エッジを N 分割し、3D value noise で内部頂点を法線方向にオフセット。
 *           bass で振幅をブースト。
 *   - rewire: 一定周期でエッジ集合の `fraction` 割を別のペアに差し替え、クロスフェード。
 *
 * フェードは LineBasicMaterial の vertex colors (additive blending 下で
 * `src.rgb = vColor * material.color` がそのまま実効輝度になる) を使い、
 * (alpha, alpha, alpha) を全頂点に書き込むことで擬似的に表現する。
 */
export class EdgeOverlay {
  readonly object3D: THREE.LineSegments;

  // Per-anchor data, sized to MAX_ANCHORS so the GUI can grow/shrink without
  // realloc. The "active count" is read from settings.edges.anchorCount.
  private anchorJoint: Int32Array;
  private anchorBonesOffset: Float32Array;     // 3 floats per anchor
  // cube モードの polyhedron 表面サンプリング seeds (4 floats per anchor:
  // faceHash, r0, r1, r2)。GLSL の sample 関数と同じロジックで CPU 側でも
  // 表面位置を再現するための uniform random uniforms。Issue #40。
  private anchorPolyR: Float32Array;
  private anchorSphereDir: Float32Array;       // 3 floats per anchor (unit)
  private anchorIsOutlier: Uint8Array;
  private anchorSpikeFreq: Float32Array;
  private anchorSpikePhase: Float32Array;
  private anchorPos: Float32Array;             // 3 per anchor, current world pos

  // 論理エッジスロット (Issue #31)。
  private edgeActive: Uint8Array;
  private edgeA: Int32Array;
  private edgeB: Int32Array;
  private edgeFadeState: Uint8Array;
  private edgeFadeStartT: Float32Array;
  private edgeFadeFrom: Float32Array;
  private edgeFadeTo: Float32Array;
  private lastRewireT = -Infinity;
  /** 直前の anchorCount/kNeighbors。変化時は edges を完全再構築する。 */
  private prevN = -1;
  private prevK = -1;
  private rewireRng: () => number;

  // Geometry buffers
  private posAttr: THREE.BufferAttribute;
  private positions: Float32Array;
  private colorAttr: THREE.BufferAttribute;
  private colors: Float32Array;
  /** 各フレームで書き込んだサブセグメント数。emit ループでカウントアップ。 */
  private segCount = 0;

  constructor() {
    const N = MAX_ANCHORS;
    this.anchorJoint = new Int32Array(N);
    this.anchorBonesOffset = new Float32Array(N * 3);
    this.anchorPolyR = new Float32Array(N * 4);
    this.anchorSphereDir = new Float32Array(N * 3);
    this.anchorIsOutlier = new Uint8Array(N);
    this.anchorSpikeFreq = new Float32Array(N);
    this.anchorSpikePhase = new Float32Array(N);
    this.anchorPos = new Float32Array(N * 3);

    this.edgeActive = new Uint8Array(MAX_EDGES);
    this.edgeA = new Int32Array(MAX_EDGES);
    this.edgeB = new Int32Array(MAX_EDGES);
    this.edgeFadeState = new Uint8Array(MAX_EDGES);
    this.edgeFadeStartT = new Float32Array(MAX_EDGES);
    this.edgeFadeFrom = new Float32Array(MAX_EDGES);
    this.edgeFadeTo = new Float32Array(MAX_EDGES);
    this.rewireRng = mulberry32(0xc0ffee);

    const rng = mulberry32(424242);

    // Distribute joint assignments roughly evenly across NUM_JOINTS.
    // Cube faces likewise. Sphere uses Fibonacci sequence.
    const PHI = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < N; i++) {
      this.anchorJoint[i] = i % NUM_JOINTS;

      this.anchorBonesOffset[i * 3 + 0] = gaussian(rng) * 0.08;
      this.anchorBonesOffset[i * 3 + 1] = gaussian(rng) * 0.08;
      this.anchorBonesOffset[i * 3 + 2] = gaussian(rng) * 0.08;

      // 4 uniforms ∈ [0,1) per anchor: faceHash, r0, r1, r2
      // 実行時に samplePolyhedronUnit に渡し polyhedron 毎の表面位置を計算する。
      this.anchorPolyR[i * 4 + 0] = rng();
      this.anchorPolyR[i * 4 + 1] = rng();
      this.anchorPolyR[i * 4 + 2] = rng();
      this.anchorPolyR[i * 4 + 3] = rng();

      // Fibonacci sphere
      const y = 1 - (i / (N - 1)) * 2;
      const radius = Math.sqrt(Math.max(0, 1 - y * y));
      const theta = PHI * i;
      this.anchorSphereDir[i * 3 + 0] = Math.cos(theta) * radius;
      this.anchorSphereDir[i * 3 + 1] = y;
      this.anchorSphereDir[i * 3 + 2] = Math.sin(theta) * radius;

      // ~1/4 of anchors flagged as spike anchors. Independent of PointCloud's
      // outlier set; it's just spice.
      this.anchorIsOutlier[i] = rng() < 0.25 ? 1 : 0;
      this.anchorSpikeFreq[i] = 1.0 + rng() * 4.0;
      this.anchorSpikePhase[i] = rng() * Math.PI * 2;
    }

    // Worst case: MAX_EDGES × MAX_SUBDIVISIONS sub-segments.
    this.positions = new Float32Array(MAX_SUB_SEGMENTS * 2 * 3);
    this.colors = new Float32Array(MAX_SUB_SEGMENTS * 2 * 3);
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.positions, 3);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.colorAttr = new THREE.BufferAttribute(this.colors, 3);
    this.colorAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("position", this.posAttr);
    geo.setAttribute("color", this.colorAttr);
    geo.setDrawRange(0, 0);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 4);

    const mat = new THREE.LineBasicMaterial({
      color: 0xffffff,
      vertexColors: true,
      transparent: true,
      opacity: 0.5,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.object3D = new THREE.LineSegments(geo, mat);
    this.object3D.frustumCulled = false;
    this.object3D.renderOrder = 10;
    this.object3D.visible = false;
  }

  update(joints: Joints, center: Float32Array, audio: AudioFeatures, settings: Settings, t: number): void {
    if (settings.mode === "lattice" || settings.mode === "image" || settings.mode === "rain") {
      this.object3D.visible = false;
      return;
    }
    const e = settings.edges;
    this.object3D.visible = e.enabled;
    if (!e.enabled) return;

    (this.object3D.material as THREE.LineBasicMaterial).opacity = Math.max(0, Math.min(1, e.alpha));

    const N = Math.max(2, Math.min(MAX_ANCHORS, Math.floor(e.anchorCount)));
    const K = Math.max(1, Math.min(MAX_K, Math.floor(e.kNeighbors)));

    // 1. Compute every anchor's current world position.
    const cx = center[0] ?? 0;
    const cy = center[1] ?? 0;
    const cz = center[2] ?? 0;
    const bass = audio.bass;
    const bExp = settings.pointCloud.bassExpansion;
    const shapeR = settings.shape.radius;
    const shapePulse = settings.shape.bassPulse;
    const oBoost = settings.outlier.boost;
    // Twist parameters mirror PointCloud's so the cloud and the edges share
    // axis / strength / phase. PointCloud applies the same transform in GLSL.
    const twistStrength = effectiveTwistStrength(settings.twist, bass);
    const twistPhaseValue = twistPhase(settings.twist, t);
    const twistAxis = settings.twist.axis;
    const twistActive = twistStrength !== 0 || twistPhaseValue !== 0;

    for (let i = 0; i < N; i++) {
      // Spike wave for this anchor
      let outlier = 1.0;
      if (this.anchorIsOutlier[i]) {
        const wave = Math.sin(t * (this.anchorSpikeFreq[i] ?? 1) + (this.anchorSpikePhase[i] ?? 0)) * 0.5 + 0.5;
        outlier = 1.0 + (oBoost - 1.0) * wave;
      }

      let x = 0, y = 0, z = 0;
      if (settings.mode === "bones") {
        const j = this.anchorJoint[i] ?? 0;
        const jx = (joints[j * 3] ?? 0) - cx;
        const jy = (joints[j * 3 + 1] ?? 0) - cy;
        const jz = (joints[j * 3 + 2] ?? 0) - cz;
        const radius = (1 + bass * bExp) * outlier;
        x = jx + (this.anchorBonesOffset[i * 3] ?? 0) * radius;
        y = jy + (this.anchorBonesOffset[i * 3 + 1] ?? 0) * radius;
        z = jz + (this.anchorBonesOffset[i * 3 + 2] ?? 0) * radius;
      } else if (settings.mode === "cube") {
        // Issue #40: cube モードは shape.polyhedron で 4|6|8|12 を切替。
        // samplePolyhedronUnit は外接球半径 1 の単位多面体上の点を返し、
        // shape.radius semantics は「外接球半径 (頂点距離)」で全多面体・sphere と統一。
        const fh = this.anchorPolyR[i * 4] ?? 0;
        const r0 = this.anchorPolyR[i * 4 + 1] ?? 0;
        const r1 = this.anchorPolyR[i * 4 + 2] ?? 0;
        const r2 = this.anchorPolyR[i * 4 + 3] ?? 0;
        const [ux, uy, uz] = samplePolyhedronUnit(settings.shape.polyhedron, fh, r0, r1, r2);
        const scale = shapeR * (1 + bass * shapePulse) * outlier;
        x = ux * scale; y = uy * scale; z = uz * scale;
      } else {
        // sphere
        const radius = shapeR * (1 + bass * shapePulse) * outlier;
        x = (this.anchorSphereDir[i * 3] ?? 0) * radius;
        y = (this.anchorSphereDir[i * 3 + 1] ?? 0) * radius;
        z = (this.anchorSphereDir[i * 3 + 2] ?? 0) * radius;
      }
      if (twistActive) {
        const [tx, ty, tz] = applyTwist(x, y, z, twistAxis, twistStrength, twistPhaseValue);
        x = tx; y = ty; z = tz;
      }
      this.anchorPos[i * 3] = x;
      this.anchorPos[i * 3 + 1] = y;
      this.anchorPos[i * 3 + 2] = z;
    }

    // 2. Edge set management (rebuild vs rewire+fade)
    const rewireOn = e.rewire.enabled && e.rewire.interval > 0;
    const needRebuild = this.prevN !== N || this.prevK !== K || !rewireOn;
    if (needRebuild) {
      this.rebuildEdgesFromKNN(N, K);
      this.lastRewireT = t;
    } else {
      if (t - this.lastRewireT >= e.rewire.interval) {
        this.rewireSome(N, K, e.rewire.fraction, e.rewire.candidatePool, t);
        this.lastRewireT = t;
      }
      this.advanceFades(t, e.rewire.fadeDuration);
    }
    this.prevN = N;
    this.prevK = K;

    // 3. Emit sub-segments for all active edges
    this.segCount = 0;
    const waveOn = e.wave.enabled;
    const S = waveOn ? Math.max(2, Math.min(MAX_SUBDIVISIONS, Math.floor(e.wave.subdivisions))) : 1;
    const ampEff = e.wave.amplitude * (1 + bass * e.wave.audioBoost);
    for (let slot = 0; slot < MAX_EDGES; slot++) {
      if (!this.edgeActive[slot]) continue;
      const alpha = this.computeEdgeAlpha(slot, t, e.rewire.fadeDuration);
      if (alpha <= 0) continue;
      const a = this.edgeA[slot]!;
      const b = this.edgeB[slot]!;
      if (a >= N || b >= N) continue; // anchorCount 縮小で範囲外になった旧エッジは emit しない
      const seed = ((a * 1009 + b * 13) % 1024) * 0.123 + 1.0;
      this.writeSubSegments(a, b, S, alpha, ampEff, e.wave.scale, e.wave.speed, t, seed);
    }

    this.posAttr.needsUpdate = true;
    this.colorAttr.needsUpdate = true;
    this.object3D.geometry.setDrawRange(0, this.segCount * 2);
  }

  /** kNN 結線で active edge slot を完全に書き直す (stable + alpha=1)。 */
  private rebuildEdgesFromKNN(N: number, K: number): void {
    this.edgeActive.fill(0);

    const seen = new Set<number>();
    const distIdx = new Int32Array(N);
    const distD = new Float32Array(N);
    let slot = 0;

    for (let i = 0; i < N; i++) {
      const ax = this.anchorPos[i * 3] ?? 0;
      const ay = this.anchorPos[i * 3 + 1] ?? 0;
      const az = this.anchorPos[i * 3 + 2] ?? 0;
      let count = 0;
      for (let j = 0; j < N; j++) {
        if (j === i) continue;
        const dx = (this.anchorPos[j * 3] ?? 0) - ax;
        const dy = (this.anchorPos[j * 3 + 1] ?? 0) - ay;
        const dz = (this.anchorPos[j * 3 + 2] ?? 0) - az;
        distIdx[count] = j;
        distD[count] = dx * dx + dy * dy + dz * dz;
        count++;
      }
      const k = Math.min(K, count);
      for (let kk = 0; kk < k; kk++) {
        let minIdx = kk;
        let minD = distD[kk] ?? Infinity;
        for (let jj = kk + 1; jj < count; jj++) {
          const d = distD[jj] ?? Infinity;
          if (d < minD) { minD = d; minIdx = jj; }
        }
        if (minIdx !== kk) {
          const td = distD[kk]!; distD[kk] = distD[minIdx]!; distD[minIdx] = td;
          const ti = distIdx[kk]!; distIdx[kk] = distIdx[minIdx]!; distIdx[minIdx] = ti;
        }
        const j = distIdx[kk] ?? i;
        const key = edgeKey(i, j);
        if (seen.has(key)) continue;
        seen.add(key);
        if (slot >= MAX_EDGES) break;
        this.edgeActive[slot] = 1;
        this.edgeA[slot] = i;
        this.edgeB[slot] = j;
        this.edgeFadeState[slot] = STATE_STABLE;
        this.edgeFadeStartT[slot] = -Infinity;
        this.edgeFadeFrom[slot] = 1;
        this.edgeFadeTo[slot] = 1;
        slot++;
      }
      if (slot >= MAX_EDGES) break;
    }
  }

  /** stable な active edge を fraction 割選んで fade-out し、新エッジを fade-in 追加。 */
  private rewireSome(N: number, K: number, fraction: number, candidatePool: number, t: number): void {
    if (fraction <= 0) return;

    const stableSlots: number[] = [];
    const activeKeys = new Set<number>();
    for (let slot = 0; slot < MAX_EDGES; slot++) {
      if (!this.edgeActive[slot]) continue;
      const fs = this.edgeFadeState[slot]!;
      if (fs === STATE_STABLE || fs === STATE_IN) {
        activeKeys.add(edgeKey(this.edgeA[slot]!, this.edgeB[slot]!));
      }
      if (fs === STATE_STABLE) stableSlots.push(slot);
    }

    const numToReplace = Math.max(0, Math.min(stableSlots.length, Math.round(fraction * stableSlots.length)));
    if (numToReplace === 0) return;

    for (let i = stableSlots.length - 1; i > 0; i--) {
      const j = Math.floor(this.rewireRng() * (i + 1));
      const tmp = stableSlots[i]!;
      stableSlots[i] = stableSlots[j]!;
      stableSlots[j] = tmp;
    }

    const M = Math.max(K, Math.min(N - 1, Math.floor(candidatePool)));

    for (let r = 0; r < numToReplace; r++) {
      const slot = stableSlots[r]!;
      const a = this.edgeA[slot]!;
      this.edgeFadeState[slot] = STATE_OUT;
      this.edgeFadeStartT[slot] = t;
      this.edgeFadeFrom[slot] = 1;
      this.edgeFadeTo[slot] = 0;
      activeKeys.delete(edgeKey(a, this.edgeB[slot]!));

      const newB = this.pickNewPartner(a, N, M, activeKeys);
      if (newB < 0) continue;
      const freeSlot = this.findFreeSlot();
      if (freeSlot < 0) continue;
      this.edgeActive[freeSlot] = 1;
      this.edgeA[freeSlot] = a;
      this.edgeB[freeSlot] = newB;
      this.edgeFadeState[freeSlot] = STATE_IN;
      this.edgeFadeStartT[freeSlot] = t;
      this.edgeFadeFrom[freeSlot] = 0;
      this.edgeFadeTo[freeSlot] = 1;
      activeKeys.add(edgeKey(a, newB));
    }
  }

  /** anchor a の最近傍 M 本から exclude に無いものをランダムに 1 本。失敗時 -1。 */
  private pickNewPartner(a: number, N: number, M: number, exclude: Set<number>): number {
    const ax = this.anchorPos[a * 3] ?? 0;
    const ay = this.anchorPos[a * 3 + 1] ?? 0;
    const az = this.anchorPos[a * 3 + 2] ?? 0;
    const distIdx = new Int32Array(N);
    const distD = new Float32Array(N);
    let count = 0;
    for (let j = 0; j < N; j++) {
      if (j === a) continue;
      const dx = (this.anchorPos[j * 3] ?? 0) - ax;
      const dy = (this.anchorPos[j * 3 + 1] ?? 0) - ay;
      const dz = (this.anchorPos[j * 3 + 2] ?? 0) - az;
      distIdx[count] = j;
      distD[count] = dx * dx + dy * dy + dz * dz;
      count++;
    }
    const k = Math.min(M, count);
    const candidates: number[] = [];
    for (let kk = 0; kk < k; kk++) {
      let minIdx = kk;
      let minD = distD[kk] ?? Infinity;
      for (let jj = kk + 1; jj < count; jj++) {
        const d = distD[jj] ?? Infinity;
        if (d < minD) { minD = d; minIdx = jj; }
      }
      if (minIdx !== kk) {
        const td = distD[kk]!; distD[kk] = distD[minIdx]!; distD[minIdx] = td;
        const ti = distIdx[kk]!; distIdx[kk] = distIdx[minIdx]!; distIdx[minIdx] = ti;
      }
      const cand = distIdx[kk] ?? -1;
      if (cand >= 0 && !exclude.has(edgeKey(a, cand))) candidates.push(cand);
    }
    if (candidates.length === 0) return -1;
    return candidates[Math.floor(this.rewireRng() * candidates.length)]!;
  }

  private findFreeSlot(): number {
    for (let s = 0; s < MAX_EDGES; s++) if (!this.edgeActive[s]) return s;
    return -1;
  }

  /** fade を時間進行させ、完了したものを stable / 非アクティブに遷移させる。 */
  private advanceFades(t: number, fadeDuration: number): void {
    const fd = fadeDuration > 0 ? fadeDuration : 1e-3;
    for (let slot = 0; slot < MAX_EDGES; slot++) {
      if (!this.edgeActive[slot]) continue;
      const st = this.edgeFadeState[slot]!;
      if (st === STATE_STABLE) continue;
      const p = clamp01((t - (this.edgeFadeStartT[slot] ?? 0)) / fd);
      if (p < 1) continue;
      if (st === STATE_IN) {
        this.edgeFadeState[slot] = STATE_STABLE;
        this.edgeFadeFrom[slot] = 1;
        this.edgeFadeTo[slot] = 1;
      } else {
        this.edgeActive[slot] = 0;
      }
    }
  }

  /** スロットの現在 alpha (0..1) を返す。stable は 1。 */
  private computeEdgeAlpha(slot: number, t: number, fadeDuration: number): number {
    const st = this.edgeFadeState[slot]!;
    if (st === STATE_STABLE) return this.edgeFadeTo[slot] ?? 1;
    const fd = fadeDuration > 0 ? fadeDuration : 1e-3;
    const p = clamp01((t - (this.edgeFadeStartT[slot] ?? 0)) / fd);
    const from = this.edgeFadeFrom[slot] ?? 0;
    const to = this.edgeFadeTo[slot] ?? 1;
    return from + (to - from) * p;
  }

  /**
   * 1 本のエッジ (a, b) を S 個のサブセグメントに展開してバッファに書き込む。
   * S=1: 直線 1 セグメント。S>1: 内部頂点を sin(π u) 重みで 3D value noise オフセット。
   */
  private writeSubSegments(
    ai: number, bi: number, S: number, alpha: number,
    ampEff: number, scale: number, speed: number, t: number,
    edgeSeed: number,
  ): void {
    const ax = this.anchorPos[ai * 3]!, ay = this.anchorPos[ai * 3 + 1]!, az = this.anchorPos[ai * 3 + 2]!;
    const bx = this.anchorPos[bi * 3]!, by = this.anchorPos[bi * 3 + 1]!, bz = this.anchorPos[bi * 3 + 2]!;
    const tx = bx - ax, ty = by - ay, tz = bz - az;

    if (S <= 1) {
      this.writePair(ax, ay, az, bx, by, bz, alpha);
      return;
    }

    const tLen = Math.hypot(tx, ty, tz) || 1;
    const tnx = tx / tLen, tny = ty / tLen, tnz = tz / tLen;
    let ux = 0, uy = 0, uz = 0;
    const ax_ = Math.abs(tnx), ay_ = Math.abs(tny), az_ = Math.abs(tnz);
    if (ax_ <= ay_ && ax_ <= az_) ux = 1;
    else if (ay_ <= az_) uy = 1;
    else uz = 1;
    let nx = tny * uz - tnz * uy;
    let ny = tnz * ux - tnx * uz;
    let nz = tnx * uy - tny * ux;
    const nLen = Math.hypot(nx, ny, nz) || 1;
    nx /= nLen; ny /= nLen; nz /= nLen;
    const bnx = tny * nz - tnz * ny;
    const bny = tnz * nx - tnx * nz;
    const bnz = tnx * ny - tny * nx;

    const sx = new Float32Array(S + 1);
    const sy = new Float32Array(S + 1);
    const sz = new Float32Array(S + 1);
    sx[0] = ax; sy[0] = ay; sz[0] = az;
    sx[S] = bx; sy[S] = by; sz[S] = bz;
    for (let k = 1; k < S; k++) {
      const u = k / S;
      const w = Math.sin(Math.PI * u);
      const baseX = ax + tx * u;
      const baseY = ay + ty * u;
      const baseZ = az + tz * u;
      const noiseN = noise3D(u * scale + edgeSeed, t * speed, edgeSeed * 0.37);
      const noiseB = noise3D(u * scale + edgeSeed + 13.1, t * speed + 7.7, edgeSeed * 0.73);
      const dN = ampEff * w * noiseN;
      const dB = ampEff * w * noiseB;
      sx[k] = baseX + nx * dN + bnx * dB;
      sy[k] = baseY + ny * dN + bny * dB;
      sz[k] = baseZ + nz * dN + bnz * dB;
    }
    for (let k = 0; k < S; k++) {
      this.writePair(sx[k]!, sy[k]!, sz[k]!, sx[k + 1]!, sy[k + 1]!, sz[k + 1]!, alpha);
    }
  }

  /** 1 セグメント (2 vertex) を positions/colors に書き込む。 */
  private writePair(
    x0: number, y0: number, z0: number,
    x1: number, y1: number, z1: number,
    alpha: number,
  ): void {
    if (this.segCount >= MAX_SUB_SEGMENTS) return;
    const off = this.segCount * 6;
    this.positions[off + 0] = x0; this.positions[off + 1] = y0; this.positions[off + 2] = z0;
    this.positions[off + 3] = x1; this.positions[off + 4] = y1; this.positions[off + 5] = z1;
    this.colors[off + 0] = alpha; this.colors[off + 1] = alpha; this.colors[off + 2] = alpha;
    this.colors[off + 3] = alpha; this.colors[off + 4] = alpha; this.colors[off + 5] = alpha;
    this.segCount++;
  }

  /** Read the most-recently-computed world position of anchor `i`. */
  getAnchorPosition(i: number): [number, number, number] {
    return [
      this.anchorPos[i * 3] ?? 0,
      this.anchorPos[i * 3 + 1] ?? 0,
      this.anchorPos[i * 3 + 2] ?? 0,
    ];
  }

  /**
   * デバッグ用: 現在 active (in / stable) なエッジの (a, b) 一覧を返す。
   * fade-out 中のスロットは含めない。テストでエッジ集合の変化を観測するのに使う。
   */
  debugListEdges(): Array<[number, number]> {
    const out: Array<[number, number]> = [];
    for (let slot = 0; slot < MAX_EDGES; slot++) {
      if (!this.edgeActive[slot]) continue;
      if (this.edgeFadeState[slot] === STATE_OUT) continue;
      out.push([this.edgeA[slot]!, this.edgeB[slot]!]);
    }
    return out;
  }
}
