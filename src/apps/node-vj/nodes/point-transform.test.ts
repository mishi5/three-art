import { expect, test, describe } from "bun:test";
import { PointTransformNode, composeTransformElements } from "./PointTransformNode";
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

describe("composeTransformElements (#102)", () => {
  test("全 0 は単位行列", () => {
    const m = composeTransformElements(0, 0, 0, 0, 0, 0);
    const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    for (let i = 0; i < 16; i++) expect(m[i]!).toBeCloseTo(I[i]!, 6);
  });

  test("平行移動のみは位置列に (tx,ty,tz)（列優先 elements[12..14]）", () => {
    const m = composeTransformElements(1, 2, 3, 0, 0, 0);
    expect(m[12]!).toBeCloseTo(1, 6);
    expect(m[13]!).toBeCloseTo(2, 6);
    expect(m[14]!).toBeCloseTo(3, 6);
  });

  test("Z 軸 90° 回転で (1,0,0)→(0,1,0)", () => {
    const m = composeTransformElements(0, 0, 0, 0, 0, 90);
    // 列優先 mat4 を点 (1,0,0,1) に適用
    const x = m[0]! * 1 + m[4]! * 0 + m[8]! * 0 + m[12]!;
    const y = m[1]! * 1 + m[5]! * 0 + m[9]! * 0 + m[13]!;
    expect(x).toBeCloseTo(0, 5);
    expect(y).toBeCloseTo(1, 5);
  });
});

describe("PointTransformNode (#102)", () => {
  test("points→points の変換ノード", () => {
    expect(PointTransformNode.type).toBe("PointTransform");
    expect(PointTransformNode.category).toBe("process");
    expect(PointTransformNode.inputs.map((p) => `${p.id}:${p.type}`)).toEqual(["points:points"]);
    expect(PointTransformNode.outputs.map((p) => `${p.id}:${p.type}`)).toEqual(["points:points"]);
  });

  test("translate/rotate param を持つ", () => {
    const ids = PointTransformNode.params.map((p) => p.id);
    for (const k of ["translateX", "translateY", "translateZ", "rotateX", "rotateY", "rotateZ"]) {
      expect(ids).toContain(k);
    }
  });

  test("state/env/入力なしでは no-op（空オブジェクト）", () => {
    expect(PointTransformNode.evaluate(ctxNoState())).toEqual({});
  });
});
