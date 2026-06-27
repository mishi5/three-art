import type { PoseFrame } from "../../../core/types";
import { makeEmptyJoints } from "../../../core/types";
import type { NodeState, NodeTypeDef } from "../graph/node-type";
import { remap } from "./process-logic";
import {
  POSE_POS, clamp01, shoulderMetrics, handHeightNorm, motionStep, jumpStep, visible,
} from "./pose-features-logic";

/** PoseFeatures のフレーム間状態。前フレーム関節・重心・時刻と EMA 値・jump 武装フラグ。 */
export class PoseFeaturesRuntime {
  prevJoints = makeEmptyJoints();
  prevCenterY = 0;
  prevTime = 0;
  hasPrev = false;
  smHandL = 0;
  smHandR = 0;
  motion = 0;
  jumpArmed = true;
}

/**
 * 身体ドリブン入力ノード（#185）。pose（PoseFrame）を受け、手の高さ・全身の動き量・ジャンプを
 * number / trigger として出力する。MediaPipe 本体起動は CameraInput に委譲（本ノードは pose を変換するだけ）。
 * 正規化（肩中心基準・肩幅で割る）をノード内蔵し、立ち位置・カメラ距離・体格に依存しない値を出す。
 */
export const PoseFeaturesNode: NodeTypeDef = {
  type: "PoseFeatures",
  category: "input",
  description: "pose（骨格）を制御信号へ変換する。手の高さ・全身の動き量・ジャンプを number/trigger で出力（肩幅で正規化済み）。",
  inputs: [
    { id: "pose", label: "pose", type: "pose", description: "CameraInput の pose 出力をつなぐ。未接続時は全出力 0。" },
  ],
  outputs: [
    { id: "handHeightL", label: "handL", type: "number", description: "左手の高さ（肩中心=0、肩幅×raiseSpan 上げで 1）。不可視時 0。" },
    { id: "handHeightR", label: "handR", type: "number", description: "右手の高さ（同上）。" },
    { id: "motion", label: "motion", type: "number", description: "全身の動き量（pose 差分から算出・motionScale で正規化）。" },
    { id: "jump", label: "jump", type: "trigger", description: "重心が jumpThreshold より速く上昇した瞬間に 1 フレーム発火。" },
  ],
  params: [
    { id: "smoothing", label: "smoothing", kind: "number", default: 0.3, min: 0.01, max: 1, step: 0.01, description: "連続出力（手の高さ・motion）の追従係数。1 で即追従、小さいほど滑らか。" },
    { id: "raiseSpan", label: "raiseSpan", kind: "number", default: 1.2, min: 0.1, max: 3, step: 0.05, description: "手の高さが 1 になる「肩幅の倍数」。小さいほど少し上げただけで反応。" },
    { id: "motionScale", label: "motionScale", kind: "number", default: 0.3, min: 0.01, max: 1, step: 0.01, description: "生の動き量を 0..1 に正規化する除数（想定する最大の動き）。" },
    { id: "jumpThreshold", label: "jumpThresh", kind: "number", default: 1.2, min: 0.05, max: 5, step: 0.05, description: "ジャンプ発火する重心の上昇速度（m/s）。小さいほど敏感。" },
    { id: "outMin", label: "outMin", kind: "number", default: 0, step: 0.1, description: "出力 Remap の下限（手の高さ・motion を [outMin,outMax] に写す）。" },
    { id: "outMax", label: "outMax", kind: "number", default: 1, step: 0.1, description: "出力 Remap の上限。" },
  ],
  createState: () => new PoseFeaturesRuntime(),
  disposeState: (_state: NodeState) => { /* no-op */ },
  evaluate: (ctx) => {
    const s = ctx.state as PoseFeaturesRuntime | undefined;
    const pose = ctx.input("pose") as PoseFrame | undefined;
    const zero = { handHeightL: 0, handHeightR: 0, motion: 0, jump: false };
    if (!s || !pose) {
      if (s) s.hasPrev = false; // 復帰時の誤発火防止
      return zero;
    }

    const smoothing = clamp01(Number(ctx.param("smoothing") ?? 0.3));
    const raiseSpan = Number(ctx.param("raiseSpan") ?? 1.2);
    const motionScale = Math.max(0.01, Number(ctx.param("motionScale") ?? 0.3));
    const jumpThreshold = Number(ctx.param("jumpThreshold") ?? 1.2);
    const outMin = Number(ctx.param("outMin") ?? 0);
    const outMax = Number(ctx.param("outMax") ?? 1);

    const { joints, visibility: vis } = pose;
    const shouldersVisible = visible(vis, POSE_POS.lShoulder) && visible(vis, POSE_POS.rShoulder);
    const { midY, width } = shoulderMetrics(joints);

    // 手の高さ（正規化値）。不可視なら literal 0 へ即時リセット。
    const out = (raw: number) => remap(raw, 0, 1, outMin, outMax, true);
    let handHeightL = 0, handHeightR = 0;
    if (shouldersVisible && visible(vis, POSE_POS.lWrist)) {
      const targetL = handHeightNorm(joints[POSE_POS.lWrist * 3 + 1] ?? 0, midY, width, raiseSpan);
      s.smHandL += (targetL - s.smHandL) * smoothing;
      handHeightL = out(s.smHandL);
    } else {
      s.smHandL = 0;
    }
    if (shouldersVisible && visible(vis, POSE_POS.rWrist)) {
      const targetR = handHeightNorm(joints[POSE_POS.rWrist * 3 + 1] ?? 0, midY, width, raiseSpan);
      s.smHandR += (targetR - s.smHandR) * smoothing;
      handHeightR = out(s.smHandR);
    } else {
      s.smHandR = 0;
    }

    // 動き量（pose 差分から getMotion 流用）。初回（prev 無し）は変位 0。
    const prev = s.hasPrev ? s.prevJoints : joints;
    s.motion = motionStep(joints, prev, vis, s.motion, smoothing);
    const motion = out(clamp01(s.motion / motionScale));

    // ジャンプ（重心 y の上昇速度）。dt は timeSec 差分。
    let jump = false;
    const centerY = pose.center[1] ?? 0;
    if (s.hasPrev) {
      const dt = ctx.timeSec - s.prevTime;
      if (dt > 1e-4) {
        const velY = (centerY - s.prevCenterY) / dt;
        const r = jumpStep(velY, jumpThreshold, s.jumpArmed);
        s.jumpArmed = r.armed;
        jump = r.fired;
      }
    }

    s.prevJoints.set(joints);
    s.prevCenterY = centerY;
    s.prevTime = ctx.timeSec;
    s.hasPrev = true;

    return { handHeightL, handHeightR, motion, jump };
  },
};
