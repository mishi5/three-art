import * as THREE from "three";
import { NUM_JOINTS, type AudioFeatures, type Joints } from "../types";
import type { Settings } from "../settings";
import { applyTwist, effectiveTwistStrength, twistPhase } from "./twist";

const MAX_ANCHORS = 256;

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

/**
 * Draws edges between a fixed set of anchor points that move with the body /
 * shape. Each anchor mirrors a particle in spirit (bones cluster, cube face,
 * sphere surface) but is its own independent point so we don't have to read
 * back the PointCloud's GPU buffer every frame.
 *
 * Anchor count and edge connectivity are tunable from the GUI. Each frame:
 *   1. Compute every anchor's current world position from the live mode.
 *   2. For every anchor, find its k nearest other anchors.
 *   3. Emit (deduped) line segments and update the LineSegments geometry.
 */
export class EdgeOverlay {
  readonly object3D: THREE.LineSegments;

  // Per-anchor data, sized to MAX_ANCHORS so the GUI can grow/shrink without
  // realloc. The "active count" is read from settings.edges.anchorCount.
  private anchorJoint: Int32Array;
  private anchorBonesOffset: Float32Array;     // 3 floats per anchor
  private anchorCubeFace: Int8Array;           // 0..5
  private anchorCubeUV: Float32Array;          // 2 floats per anchor, [-1, 1]^2
  private anchorSphereDir: Float32Array;       // 3 floats per anchor (unit)
  private anchorIsOutlier: Uint8Array;
  private anchorSpikeFreq: Float32Array;
  private anchorSpikePhase: Float32Array;
  private anchorPos: Float32Array;             // 3 per anchor, current world pos

  // Geometry buffer sized for the worst case: every anchor → k partners.
  private posAttr: THREE.BufferAttribute;
  private positions: Float32Array;

  constructor() {
    const N = MAX_ANCHORS;
    this.anchorJoint = new Int32Array(N);
    this.anchorBonesOffset = new Float32Array(N * 3);
    this.anchorCubeFace = new Int8Array(N);
    this.anchorCubeUV = new Float32Array(N * 2);
    this.anchorSphereDir = new Float32Array(N * 3);
    this.anchorIsOutlier = new Uint8Array(N);
    this.anchorSpikeFreq = new Float32Array(N);
    this.anchorSpikePhase = new Float32Array(N);
    this.anchorPos = new Float32Array(N * 3);

    const rng = mulberry32(424242);

    // Distribute joint assignments roughly evenly across NUM_JOINTS.
    // Cube faces likewise. Sphere uses Fibonacci sequence.
    const PHI = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < N; i++) {
      this.anchorJoint[i] = i % NUM_JOINTS;

      this.anchorBonesOffset[i * 3 + 0] = gaussian(rng) * 0.08;
      this.anchorBonesOffset[i * 3 + 1] = gaussian(rng) * 0.08;
      this.anchorBonesOffset[i * 3 + 2] = gaussian(rng) * 0.08;

      this.anchorCubeFace[i] = i % 6;
      this.anchorCubeUV[i * 2 + 0] = (rng() - 0.5) * 2;
      this.anchorCubeUV[i * 2 + 1] = (rng() - 0.5) * 2;

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

    // Worst case: every anchor draws K_MAX_NEIGHBORS edges. Allocate generously.
    const maxSegments = MAX_ANCHORS * 5;
    this.positions = new Float32Array(maxSegments * 2 * 3);
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.positions, 3);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("position", this.posAttr);
    geo.setDrawRange(0, 0);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 4);

    const mat = new THREE.LineBasicMaterial({
      color: 0xffffff,
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
    if (settings.mode === "lattice") {
      this.object3D.visible = false;
      return;
    }
    const e = settings.edges;
    this.object3D.visible = e.enabled;
    if (!e.enabled) return;

    (this.object3D.material as THREE.LineBasicMaterial).opacity = Math.max(0, Math.min(1, e.alpha));

    const N = Math.max(2, Math.min(MAX_ANCHORS, Math.floor(e.anchorCount)));
    const K = Math.max(1, Math.min(5, Math.floor(e.kNeighbors)));

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
        const face = this.anchorCubeFace[i] ?? 0;
        const u = this.anchorCubeUV[i * 2] ?? 0;
        const v = this.anchorCubeUV[i * 2 + 1] ?? 0;
        let bx = 0, by = 0, bz = 0;
        if (face === 0)      { bx =  1; by = u; bz = v; }
        else if (face === 1) { bx = -1; by = u; bz = v; }
        else if (face === 2) { bx = u; by =  1; bz = v; }
        else if (face === 3) { bx = u; by = -1; bz = v; }
        else if (face === 4) { bx = u; by = v; bz =  1; }
        else                 { bx = u; by = v; bz = -1; }
        const scale = shapeR * (1 + bass * shapePulse) * outlier;
        x = bx * scale; y = by * scale; z = bz * scale;
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

    // 2. k-nearest neighbours per anchor → unique edge pairs.
    // For N=64 this is N*N = 4096 distance ops per frame, fine.
    const seen = new Set<number>();
    let segCount = 0;
    const writeSeg = (a: number, b: number): void => {
      const lo = a < b ? a : b;
      const hi = a < b ? b : a;
      const key = lo * MAX_ANCHORS + hi;
      if (seen.has(key)) return;
      seen.add(key);
      const off = segCount * 6;
      this.positions[off + 0] = this.anchorPos[a * 3] ?? 0;
      this.positions[off + 1] = this.anchorPos[a * 3 + 1] ?? 0;
      this.positions[off + 2] = this.anchorPos[a * 3 + 2] ?? 0;
      this.positions[off + 3] = this.anchorPos[b * 3] ?? 0;
      this.positions[off + 4] = this.anchorPos[b * 3 + 1] ?? 0;
      this.positions[off + 5] = this.anchorPos[b * 3 + 2] ?? 0;
      segCount++;
    };

    // Scratch buffers reused inside the loop
    const distIdx = new Int32Array(N);
    const distD = new Float32Array(N);

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
      // Partial selection sort for K smallest
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
        writeSeg(i, distIdx[kk] ?? i);
      }
    }

    this.posAttr.needsUpdate = true;
    this.object3D.geometry.setDrawRange(0, segCount * 2);
  }

  /** Read the most-recently-computed world position of anchor `i`. */
  getAnchorPosition(i: number): [number, number, number] {
    return [
      this.anchorPos[i * 3] ?? 0,
      this.anchorPos[i * 3 + 1] ?? 0,
      this.anchorPos[i * 3 + 2] ?? 0,
    ];
  }
}
