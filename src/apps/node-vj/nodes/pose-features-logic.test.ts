import { expect, test, describe } from "bun:test";
import { NUM_JOINTS, makeEmptyJoints } from "../../../core/types";
import {
  POSE_POS, VIS_MIN, clamp01, shoulderMetrics, handHeightNorm,
  motionStep, visible,
} from "./pose-features-logic";

/** 全関節可視の visibility を作る。 */
function fullVis(): Float32Array {
  return new Float32Array(NUM_JOINTS).fill(1);
}

/** joints の関節 i に [x,y,z] をセットしたコピーを返す。 */
function withJoint(j: Float32Array, i: number, x: number, y: number, z: number): Float32Array {
  const out = new Float32Array(j);
  out[i * 3] = x; out[i * 3 + 1] = y; out[i * 3 + 2] = z;
  return out;
}

describe("clamp01", () => {
  test("範囲外を 0..1 に丸める", () => {
    expect(clamp01(-0.5)).toBe(0);
    expect(clamp01(0.3)).toBeCloseTo(0.3);
    expect(clamp01(2)).toBe(1);
  });
});

describe("shoulderMetrics", () => {
  test("肩中心 y と肩幅（3D 距離）", () => {
    let j = makeEmptyJoints();
    j = withJoint(j, POSE_POS.lShoulder, -0.2, 1.0, 0);
    j = withJoint(j, POSE_POS.rShoulder, 0.2, 1.4, 0);
    const m = shoulderMetrics(j);
    expect(m.midY).toBeCloseTo(1.2);
    expect(m.width).toBeCloseTo(Math.hypot(0.4, 0.4, 0));
  });
});

describe("handHeightNorm", () => {
  test("肩の高さで 0、肩幅×raiseSpan 上で 1", () => {
    // width=0.4, raiseSpan=1 → denom=0.4。midY=1.0。
    expect(handHeightNorm(1.0, 1.0, 0.4, 1)).toBeCloseTo(0);
    expect(handHeightNorm(1.4, 1.0, 0.4, 1)).toBeCloseTo(1);
    expect(handHeightNorm(0.8, 1.0, 0.4, 1)).toBeCloseTo(-0.5);
  });

  test("体格非依存: 肩幅が倍でも腕を肩幅ぶん上げれば同じ 1", () => {
    const small = handHeightNorm(1.0 + 0.3, 1.0, 0.3, 1); // 肩幅0.3
    const big = handHeightNorm(1.0 + 0.6, 1.0, 0.6, 1);   // 肩幅0.6
    expect(small).toBeCloseTo(1);
    expect(big).toBeCloseTo(1);
    expect(small).toBeCloseTo(big);
  });

  test("肩幅が極小なら 0（破綻回避）", () => {
    expect(handHeightNorm(2, 1, 0, 1)).toBe(0);
  });
});

describe("motionStep", () => {
  test("変位ゼロなら 0 に向かう", () => {
    const j = makeEmptyJoints();
    expect(motionStep(j, j, fullVis(), 0, 0.5)).toBe(0);
  });

  test("可視関節の変位を可視度重みで合計し平滑", () => {
    const prev = makeEmptyJoints();
    const cur = withJoint(prev, POSE_POS.nose, 0, 0.1, 0); // dy=0.1
    // smooth=1 → 生の合計 0.1*vis(=1) がそのまま
    expect(motionStep(cur, prev, fullVis(), 0, 1)).toBeCloseTo(0.1);
  });

  test("不可視関節は寄与しない", () => {
    const prev = makeEmptyJoints();
    const cur = withJoint(prev, POSE_POS.nose, 0, 0.1, 0);
    const vis = fullVis();
    vis[POSE_POS.nose] = VIS_MIN - 0.01; // 不可視化
    expect(motionStep(cur, prev, vis, 0, 1)).toBe(0);
  });

  test("平滑: prevMotion と新値を smooth で内挿", () => {
    const j = makeEmptyJoints();
    // 変位0・prevMotion=1・smooth=0.25 → 1*0.75 + 0*0.25 = 0.75
    expect(motionStep(j, j, fullVis(), 1, 0.25)).toBeCloseTo(0.75);
  });
});

describe("visible", () => {
  test("VIS_MIN 以上で可視", () => {
    const vis = new Float32Array(NUM_JOINTS);
    vis[3] = VIS_MIN;
    vis[4] = VIS_MIN - 0.01;
    expect(visible(vis, 3)).toBe(true);
    expect(visible(vis, 4)).toBe(false);
  });
});
