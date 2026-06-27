import { expect, test, describe } from "bun:test";
import { PoseFeaturesNode, PoseFeaturesRuntime } from "./PoseFeaturesNode";
import { POSE_POS } from "./pose-features-logic";
import type { EvalContext } from "../graph/node-type";
import type { PoseFrame } from "../../../core/types";
import { NUM_JOINTS, makeEmptyJoints } from "../../../core/types";

type Out = { handHeightL: number; handHeightR: number; motion: number; jump: boolean };

const DEFAULTS: Record<string, number> = {
  smoothing: 1, raiseSpan: 1.2, motionScale: 0.3, jumpThreshold: 1.2, outMin: 0, outMax: 1,
};

/** 肩（幅0.4・高さ1.0）を立て、必要関節を可視にした PoseFrame を作る。 */
function makePose(opts: {
  lWristY?: number; rWristY?: number; centerY?: number;
  visibleWrists?: boolean; visibleShoulders?: boolean;
  joints?: Float32Array;
} = {}): PoseFrame {
  const joints = opts.joints ?? makeEmptyJoints();
  // 肩: l=(-0.2,1.0) r=(0.2,1.0) → midY=1.0, width=0.4
  joints[POSE_POS.lShoulder * 3] = -0.2; joints[POSE_POS.lShoulder * 3 + 1] = 1.0;
  joints[POSE_POS.rShoulder * 3] = 0.2; joints[POSE_POS.rShoulder * 3 + 1] = 1.0;
  if (opts.lWristY !== undefined) joints[POSE_POS.lWrist * 3 + 1] = opts.lWristY;
  if (opts.rWristY !== undefined) joints[POSE_POS.rWrist * 3 + 1] = opts.rWristY;
  const visibility = new Float32Array(NUM_JOINTS);
  if (opts.visibleShoulders !== false) { visibility[POSE_POS.lShoulder] = 1; visibility[POSE_POS.rShoulder] = 1; }
  if (opts.visibleWrists !== false) { visibility[POSE_POS.lWrist] = 1; visibility[POSE_POS.rWrist] = 1; }
  const center = new Float32Array([0, opts.centerY ?? 1.0, 0]);
  return { joints, visibility, center };
}

function mkCtx(
  state: PoseFeaturesRuntime | undefined, t: number, pose: PoseFrame | undefined,
  params: Partial<Record<string, number>> = {},
): EvalContext {
  const p = { ...DEFAULTS, ...params };
  return {
    timeSec: t,
    input: (id) => (id === "pose" ? pose : undefined),
    param: (id) => p[id],
    node: { id: "pf", type: "PoseFeatures", params: {} },
    state,
  };
}

const run = (ctx: EvalContext): Out => PoseFeaturesNode.evaluate(ctx) as Out;

describe("PoseFeaturesNode (#185) メタ", () => {
  test("input=pose / 出力4本 / params", () => {
    expect(PoseFeaturesNode.type).toBe("PoseFeatures");
    expect(PoseFeaturesNode.category).toBe("input");
    expect(PoseFeaturesNode.inputs.map((p) => `${p.id}:${p.type}`)).toEqual(["pose:pose"]);
    expect(PoseFeaturesNode.outputs.map((p) => `${p.id}:${p.type}`)).toEqual([
      "handHeightL:number", "handHeightR:number", "motion:number", "jump:trigger",
    ]);
    expect(PoseFeaturesNode.params.map((p) => p.id)).toEqual([
      "smoothing", "raiseSpan", "motionScale", "jumpThreshold", "outMin", "outMax",
    ]);
  });
});

describe("PoseFeaturesNode 出力", () => {
  test("pose 未接続は全出力 0・jump 非発火", () => {
    const o = run(mkCtx(new PoseFeaturesRuntime(), 0, undefined));
    expect(o).toEqual({ handHeightL: 0, handHeightR: 0, motion: 0, jump: false });
  });

  test("手を肩の高さに置くと 0、肩幅×raiseSpan 上げると 1", () => {
    const s = new PoseFeaturesRuntime();
    // 肩の高さ(1.0)
    let o = run(mkCtx(s, 0, makePose({ rWristY: 1.0 })));
    expect(o.handHeightR).toBeCloseTo(0, 5);
    // raiseSpan=1.2, width=0.4 → 0.48 上 = y1.48 で 1
    o = run(mkCtx(s, 0.1, makePose({ rWristY: 1.48 })));
    expect(o.handHeightR).toBeCloseTo(1, 4);
  });

  test("出力 Remap が反映される（outMin/outMax）", () => {
    const s = new PoseFeaturesRuntime();
    const o = run(mkCtx(s, 0, makePose({ rWristY: 1.48 }), { outMin: 10, outMax: 20 }));
    expect(o.handHeightR).toBeCloseTo(20, 3);
  });

  test("手首が不可視なら 0", () => {
    const s = new PoseFeaturesRuntime();
    const o = run(mkCtx(s, 0, makePose({ rWristY: 1.48, visibleWrists: false })));
    expect(o.handHeightR).toBe(0);
  });

  test("ジャンプ: 重心が速く上昇した瞬間に 1 度発火、停止で再武装", () => {
    const s = new PoseFeaturesRuntime();
    // frame0: prev 確定（hasPrev=false なので発火しない）
    expect(run(mkCtx(s, 0, makePose({ centerY: 1.0 }))).jump).toBe(false);
    // frame1: 0.1s で +0.2m → 2.0 m/s >= 1.2 → 発火
    expect(run(mkCtx(s, 0.1, makePose({ centerY: 1.2 }))).jump).toBe(true);
    // frame2: 静止 → 速度0 → 再武装（発火しない）
    expect(run(mkCtx(s, 0.2, makePose({ centerY: 1.2 }))).jump).toBe(false);
    // frame3: 再び上昇 → 再発火
    expect(run(mkCtx(s, 0.3, makePose({ centerY: 1.4 }))).jump).toBe(true);
  });

  test("動き量: 関節が動くと motion>0、静止で減衰", () => {
    const s = new PoseFeaturesRuntime();
    // frame0: prev 確定
    run(mkCtx(s, 0, makePose({ rWristY: 1.0 })));
    // frame1: 手首を動かす → motion 上昇
    const moved = run(mkCtx(s, 0.1, makePose({ rWristY: 1.3 }), { motionScale: 1 }));
    expect(moved.motion).toBeGreaterThan(0);
    // frame2: 静止（同じ姿勢）→ smoothing=1 で生変位0 → motion 0
    const still = run(mkCtx(s, 0.2, makePose({ rWristY: 1.3 }), { motionScale: 1 }));
    expect(still.motion).toBeCloseTo(0, 5);
  });

  test("pose が途切れて復帰しても誤発火しない", () => {
    const s = new PoseFeaturesRuntime();
    run(mkCtx(s, 0, makePose({ centerY: 1.0 })));
    // pose 途切れ（hasPrev=false にリセット）
    run(mkCtx(s, 0.1, undefined));
    // 復帰直後は prev 無し扱いで jump 発火しない
    expect(run(mkCtx(s, 0.2, makePose({ centerY: 3.0 }))).jump).toBe(false);
  });

  test("state 無しでは全 0", () => {
    const o = run(mkCtx(undefined, 0, makePose({ rWristY: 1.48 })));
    expect(o).toEqual({ handHeightL: 0, handHeightR: 0, motion: 0, jump: false });
  });
});
