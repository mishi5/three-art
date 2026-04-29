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
  }

  getSmoothed(): Joints {
    return this.smoothed;
  }
}
