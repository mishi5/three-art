import { expect, test, describe } from "bun:test";
import * as THREE from "three";
import { PointShapeNode, shapeCount, latticeN, MAX_COUNT, packPoseUniforms } from "./PointShapeNode";
import { NUM_JOINTS, type PoseFrame } from "../../../core/types";
import type { EvalContext } from "../graph/node-type";

function ctxNoState(over: Partial<EvalContext> = {}): EvalContext {
  return {
    timeSec: 0,
    input: () => undefined,
    param: () => undefined,
    node: { id: "x", type: "T", params: {} },
    ...over,
  };
}

describe("PointShape mode param (#104)", () => {
  test("mode enum に cube/sphere/lattice/bones", () => {
    const mode = PointShapeNode.params.find((p) => p.id === "mode");
    expect(mode?.kind).toBe("enum");
    expect(mode?.options).toEqual(["cube", "sphere", "lattice", "bones"]);
    expect(mode?.default).toBe("cube");
  });

  test("全 mode 共通の param のみ（mode 依存の無効 param が無い）: noise 系を持ち latticeResolution は無い", () => {
    const ids = PointShapeNode.params.map((p) => p.id);
    expect(ids).toEqual(["mode", "count", "radius", "noiseAmount", "noiseScale"]);
    expect(ids).not.toContain("latticeResolution");
  });

  test("audio 入力ポートを持つ（noise の bass 反応用・任意）", () => {
    expect(PointShapeNode.inputs.find((p) => p.id === "signal")?.type).toBe("signal");
  });
});

describe("shapeCount / latticeN (#104)", () => {
  test("count は全 mode 共通。lattice は count から N=round(cbrt(count)) を導出し N^3", () => {
    expect(shapeCount("cube", 4000)).toBe(4000);
    expect(shapeCount("sphere", 2500)).toBe(2500);
    const n = latticeN(4000);
    expect(n).toBe(16);                 // round(cbrt(4000)) = 16
    expect(shapeCount("lattice", 4000)).toBe(n * n * n); // 4096
  });
  test("最小 1・上限 MAX_COUNT にクランプ", () => {
    expect(shapeCount("cube", 0)).toBe(1);
    expect(shapeCount("cube", 999999)).toBe(MAX_COUNT);
    expect(shapeCount("lattice", 999999)).toBeLessThanOrEqual(MAX_COUNT);
  });
});

describe("PointShape evaluate no-op (#104)", () => {
  test("state/env 無しは空オブジェクト", () => {
    expect(PointShapeNode.evaluate(ctxNoState())).toEqual({});
  });
});

describe("PointShape bones モード (#120)", () => {
  test("pose 入力ポートを持つ（任意・骨格追従用）", () => {
    expect(PointShapeNode.inputs.find((p) => p.id === "pose")?.type).toBe("pose");
  });

  test("param は全 mode 共通のまま（bones で増えない）", () => {
    const ids = PointShapeNode.params.map((p) => p.id);
    expect(ids).toEqual(["mode", "count", "radius", "noiseAmount", "noiseScale"]);
  });

  test("shapeCount(bones) は cube と同様に count をそのまま使い、クランプも効く", () => {
    expect(shapeCount("bones", 4000)).toBe(4000);
    expect(shapeCount("bones", 0)).toBe(1);
    expect(shapeCount("bones", 999999)).toBe(MAX_COUNT);
  });
});

describe("packPoseUniforms (#120)", () => {
  function makeTargets() {
    const joints = Array.from({ length: NUM_JOINTS }, () => new THREE.Vector3(9, 9, 9));
    const visibility = new Array<number>(NUM_JOINTS).fill(9);
    const center = new THREE.Vector3(9, 9, 9);
    return { joints, visibility, center };
  }

  test("pose から joints / visibility / center を詰める", () => {
    const joints = new Float32Array(NUM_JOINTS * 3);
    const visibility = new Float32Array(NUM_JOINTS);
    for (let j = 0; j < NUM_JOINTS; j++) {
      joints[j * 3] = j;
      joints[j * 3 + 1] = j + 0.1;
      joints[j * 3 + 2] = j + 0.2;
      visibility[j] = j / NUM_JOINTS;
    }
    const pose: PoseFrame = { joints, visibility, center: new Float32Array([1, 2, 3]) };
    const t = makeTargets();
    packPoseUniforms(pose, t.joints, t.visibility, t.center);

    expect(t.joints[5]!.x).toBeCloseTo(5);
    expect(t.joints[5]!.y).toBeCloseTo(5.1);
    expect(t.joints[5]!.z).toBeCloseTo(5.2);
    expect(t.visibility[5]).toBeCloseTo(5 / NUM_JOINTS);
    expect(t.center.toArray()).toEqual([1, 2, 3]);
  });

  test("pose 未接続（undefined）は全 visibility を 0 にして粒子を不可視化", () => {
    const t = makeTargets();
    packPoseUniforms(undefined, t.joints, t.visibility, t.center);
    expect(t.visibility.every((v) => v === 0)).toBe(true);
  });
});
