import * as THREE from "three";
import { NUM_JOINTS, type Joints } from "../types";

/**
 * 3D wireframe skeleton drawn at the same world positions as the PointCloud
 * joint clusters. Useful for confirming where each joint actually lives in
 * Three.js world space (and whether re-centering is being applied).
 *
 * JOINT_INDICES order (declared in types.ts) is used by aJointIndex below:
 *   0 nose, 1 Lshoulder, 2 Rshoulder, 3 Lelbow, 4 Relbow,
 *   5 Lwrist, 6 Rwrist, 7 Lhip, 8 Rhip,
 *   9 Lknee, 10 Rknee, 11 Lankle, 12 Rankle.
 */
const BONE_PAIRS: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [0, 2],         // nose to shoulders
  [1, 2],                 // collarbone
  [1, 3], [3, 5],         // L arm
  [2, 4], [4, 6],         // R arm
  [1, 7], [2, 8],         // shoulders to hips
  [7, 8],                 // waist
  [7, 9], [9, 11],        // L leg
  [8, 10], [10, 12],      // R leg
];

export class SkeletonGuide {
  readonly object3D: THREE.LineSegments;
  private positions: Float32Array;
  private visibility: Float32Array;
  private colors: Float32Array;
  private posAttr: THREE.BufferAttribute;
  private colAttr: THREE.BufferAttribute;

  constructor() {
    const geom = new THREE.BufferGeometry();
    const segCount = BONE_PAIRS.length * 2; // 2 endpoints per segment
    this.positions = new Float32Array(segCount * 3);
    this.colors = new Float32Array(segCount * 3);
    this.visibility = new Float32Array(NUM_JOINTS);
    this.posAttr = new THREE.BufferAttribute(this.positions, 3);
    this.colAttr = new THREE.BufferAttribute(this.colors, 3);
    geom.setAttribute("position", this.posAttr);
    geom.setAttribute("color", this.colAttr);
    geom.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 4);

    const mat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });

    this.object3D = new THREE.LineSegments(geom, mat);
    this.object3D.frustumCulled = false;
    this.object3D.visible = false;
    this.object3D.renderOrder = 999;
  }

  toggle(): boolean {
    this.object3D.visible = !this.object3D.visible;
    return this.object3D.visible;
  }

  update(joints: Joints, vis: Float32Array, center: Float32Array): void {
    const cx = center[0] ?? 0;
    const cy = center[1] ?? 0;
    const cz = center[2] ?? 0;
    let off = 0;
    for (const [a, b] of BONE_PAIRS) {
      const ax = (joints[a * 3] ?? 0) - cx;
      const ay = (joints[a * 3 + 1] ?? 0) - cy;
      const az = (joints[a * 3 + 2] ?? 0) - cz;
      const bx = (joints[b * 3] ?? 0) - cx;
      const by = (joints[b * 3 + 1] ?? 0) - cy;
      const bz = (joints[b * 3 + 2] ?? 0) - cz;
      this.positions[off + 0] = ax;
      this.positions[off + 1] = ay;
      this.positions[off + 2] = az;
      this.positions[off + 3] = bx;
      this.positions[off + 4] = by;
      this.positions[off + 5] = bz;

      const va = vis[a] ?? 0;
      const vb = vis[b] ?? 0;
      const v = Math.min(va, vb);
      // visible joints: cyan; invisible: dim red so we can see extrapolated
      // (untrustworthy) joints distinctly.
      const cR = v < 0.4 ? 0.4 : 0.0;
      const cG = v < 0.4 ? 0.0 : 1.0;
      const cB = v < 0.4 ? 0.0 : 1.0;
      this.colors[off + 0] = cR;
      this.colors[off + 1] = cG;
      this.colors[off + 2] = cB;
      this.colors[off + 3] = cR;
      this.colors[off + 4] = cG;
      this.colors[off + 5] = cB;
      off += 6;
    }
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
  }
}
