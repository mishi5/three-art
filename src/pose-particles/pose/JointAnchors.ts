import type { PoseLandmarkerResult } from "@mediapipe/tasks-vision";
import {
  JOINT_INDICES,
  NUM_JOINTS,
  makeEmptyJoints,
  type Joints,
} from "../types";

type Landmark = { x: number; y: number; z: number; visibility?: number };

/** 既定 lerp 係数（毎フレームの追従強度。0..1） */
const DEFAULT_LERP = 0.25;

export class JointAnchors {
  private smoothed: Joints = makeEmptyJoints();
  private latest: Joints = makeEmptyJoints();
  private latestVis: Float32Array = new Float32Array(NUM_JOINTS);
  private smoothedVis: Float32Array = new Float32Array(NUM_JOINTS);
  private smoothedCenter: Float32Array = new Float32Array(3);
  private prevSmoothed: Joints = makeEmptyJoints();
  private smoothedMotion: number = 0;
  private hasLatest = false;

  /** MediaPipe の結果（または同型）を取り込む */
  update(landmarks: Landmark[] | PoseLandmarkerResult): void {
    const lms = Array.isArray(landmarks)
      ? landmarks
      : (landmarks.worldLandmarks?.[0] ?? null);
    if (!lms || lms.length < 33) return;
    for (let i = 0; i < NUM_JOINTS; i++) {
      const idx = JOINT_INDICES[i]!;
      const lm = lms[idx];
      if (!lm) continue;
      this.latest[i * 3 + 0] = lm.x;
      this.latest[i * 3 + 1] = -lm.y; // y 反転
      this.latest[i * 3 + 2] = lm.z;
      this.latestVis[i] = lm.visibility ?? 1;
    }
    this.hasLatest = true;
  }

  /** 平滑化を 1 ステップ進める。factor=1 で最新へ即座に追従。*/
  tick(factor: number = DEFAULT_LERP): void {
    if (!this.hasLatest) return;
    for (let i = 0; i < this.smoothed.length; i++) {
      const cur = this.smoothed[i] ?? 0;
      const tgt = this.latest[i] ?? 0;
      this.smoothed[i] = cur + (tgt - cur) * factor;
    }
    for (let i = 0; i < NUM_JOINTS; i++) {
      const cur = this.smoothedVis[i] ?? 0;
      const tgt = this.latestVis[i] ?? 0;
      this.smoothedVis[i] = cur + (tgt - cur) * factor;
    }
    // 見える関節の重心を計算 → smoothedCenter にゆっくり追従させる
    let cx = 0, cy = 0, cz = 0, total = 0;
    for (let i = 0; i < NUM_JOINTS; i++) {
      const v = this.smoothedVis[i] ?? 0;
      if (v < 0.4) continue;
      cx += (this.smoothed[i * 3] ?? 0) * v;
      cy += (this.smoothed[i * 3 + 1] ?? 0) * v;
      cz += (this.smoothed[i * 3 + 2] ?? 0) * v;
      total += v;
    }
    if (total > 0) {
      cx /= total; cy /= total; cz /= total;
      // ゆっくりした追従（factor の半分）でカクつき抑制
      const cf = factor * 0.5;
      this.smoothedCenter[0] = (this.smoothedCenter[0] ?? 0) + (cx - (this.smoothedCenter[0] ?? 0)) * cf;
      this.smoothedCenter[1] = (this.smoothedCenter[1] ?? 0) + (cy - (this.smoothedCenter[1] ?? 0)) * cf;
      this.smoothedCenter[2] = (this.smoothedCenter[2] ?? 0) + (cz - (this.smoothedCenter[2] ?? 0)) * cf;
    }

    // Motion magnitude: total joint displacement since last tick, weighted by
    // visibility (so an extrapolated leg flickering doesn't dominate). Smoothed.
    let m = 0;
    for (let i = 0; i < NUM_JOINTS; i++) {
      const v = this.smoothedVis[i] ?? 0;
      if (v < 0.4) continue;
      const dx = (this.smoothed[i * 3] ?? 0) - (this.prevSmoothed[i * 3] ?? 0);
      const dy = (this.smoothed[i * 3 + 1] ?? 0) - (this.prevSmoothed[i * 3 + 1] ?? 0);
      const dz = (this.smoothed[i * 3 + 2] ?? 0) - (this.prevSmoothed[i * 3 + 2] ?? 0);
      m += Math.sqrt(dx * dx + dy * dy + dz * dz) * v;
    }
    // Snapshot for next tick
    this.prevSmoothed.set(this.smoothed);
    // Smooth (heavier smoothing than position so it doesn't twitch wildly)
    this.smoothedMotion = this.smoothedMotion * 0.85 + m * 0.15;
  }

  getSmoothed(): Joints {
    return this.smoothed;
  }

  /** 関節ごとの平滑化された visibility（0..1）。シェーダで alpha や引力に乗せる */
  getVisibility(): Float32Array {
    return this.smoothedVis;
  }

  /** 見える関節の重心（visibility 加重平均）。シェーダで全関節からこれを引き算して画面中央に再配置する */
  getCenter(): Float32Array {
    return this.smoothedCenter;
  }

  /** 平滑化した「体の動きの大きさ」。可視関節の毎フレーム変位の合計 (m/frame)。
   *  静止時は ~0、ゆるい動きで ~0.05、大きな動きで ~0.3 程度。 */
  getMotion(): number {
    return this.smoothedMotion;
  }
}
