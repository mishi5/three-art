// #185: PoseFeatures ノードの純粋ロジック（テスト可能に分離）。
// PoseFrame.joints は JOINT_INDICES 順（0..12）で詰めた平滑化済み 3D 座標（y 反転済み=上が +）。

import { NUM_JOINTS } from "../../../core/types";

/** PoseFrame.joints / visibility 内の関節位置（JOINT_INDICES の並び順）。 */
export const POSE_POS = {
  nose: 0,
  lShoulder: 1,
  rShoulder: 2,
  lElbow: 3,
  rElbow: 4,
  lWrist: 5,
  rWrist: 6,
  lHip: 7,
  rHip: 8,
  lKnee: 9,
  rKnee: 10,
  lAnkle: 11,
  rAnkle: 12,
} as const;

/** 可視度しきい値（既存 JointAnchors と統一）。これ未満の関節は寄与から除外。 */
export const VIS_MIN = 0.4;

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** joints から関節 i の y 座標を引く。 */
export function jointY(joints: Float32Array, i: number): number {
  return joints[i * 3 + 1] ?? 0;
}

/** 肩中心の y と肩幅（3D 距離）。立ち位置・カメラ距離・体格に依存しない正規化の基準。 */
export function shoulderMetrics(joints: Float32Array): { midY: number; width: number } {
  const li = POSE_POS.lShoulder, ri = POSE_POS.rShoulder;
  const lx = joints[li * 3] ?? 0, ly = joints[li * 3 + 1] ?? 0, lz = joints[li * 3 + 2] ?? 0;
  const rx = joints[ri * 3] ?? 0, ry = joints[ri * 3 + 1] ?? 0, rz = joints[ri * 3 + 2] ?? 0;
  const midY = (ly + ry) / 2;
  const width = Math.hypot(lx - rx, ly - ry, lz - rz);
  return { midY, width };
}

/**
 * 手の高さの正規化値。肩中心で 0、肩幅×raiseSpan ぶん上で 1、下げると負。
 * 肩幅が極小（後ろ向き・検出破綻）なら 0 を返す。
 */
export function handHeightNorm(
  wristY: number, midY: number, width: number, raiseSpan: number,
): number {
  const denom = width * Math.max(0.01, raiseSpan);
  if (denom < 1e-4) return 0;
  return (wristY - midY) / denom;
}

/**
 * 全身の動き量（getMotion() 流用）。可視関節の毎フレーム変位を可視度で重み付けして合計し、
 * 指数平滑（既存と同じ 0.85/0.15 相当を smooth で可変化）。prevJoints が無い初回は変位 0。
 */
export function motionStep(
  joints: Float32Array, prevJoints: Float32Array, vis: Float32Array,
  prevMotion: number, smooth: number,
): number {
  let m = 0;
  for (let i = 0; i < NUM_JOINTS; i++) {
    const v = vis[i] ?? 0;
    if (v < VIS_MIN) continue;
    const dx = (joints[i * 3] ?? 0) - (prevJoints[i * 3] ?? 0);
    const dy = (joints[i * 3 + 1] ?? 0) - (prevJoints[i * 3 + 1] ?? 0);
    const dz = (joints[i * 3 + 2] ?? 0) - (prevJoints[i * 3 + 2] ?? 0);
    m += Math.hypot(dx, dy, dz) * v;
  }
  const s = clamp01(smooth);
  return prevMotion * (1 - s) + m * s;
}

/**
 * ジャンプ検出。重心 y の上昇速度 velY（m/s）がしきい値超で 1 度だけ発火し、再武装は
 * しきい値の半分を下回ったとき（ヒステリシスで連続発火を防ぐ）。
 */
export function jumpStep(
  velY: number, threshold: number, armed: boolean,
): { fired: boolean; armed: boolean } {
  const th = Math.max(1e-4, threshold);
  if (armed && velY >= th) return { fired: true, armed: false };
  if (!armed && velY < th * 0.5) return { fired: false, armed: true };
  return { fired: false, armed };
}

/** 関節 i が可視か。 */
export function visible(vis: Float32Array, i: number): boolean {
  return (vis[i] ?? 0) >= VIS_MIN;
}
