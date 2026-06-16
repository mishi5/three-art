import { expect, test, describe } from "bun:test";
import { PointShapeNode, shapeCount, latticeN, MAX_COUNT } from "./PointShapeNode";
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
  test("mode enum に cube/sphere/lattice", () => {
    const mode = PointShapeNode.params.find((p) => p.id === "mode");
    expect(mode?.kind).toBe("enum");
    expect(mode?.options).toEqual(["cube", "sphere", "lattice"]);
    expect(mode?.default).toBe("cube");
  });

  test("全 mode 共通の param のみ（mode 依存の無効 param が無い）: noise 系を持ち latticeResolution は無い", () => {
    const ids = PointShapeNode.params.map((p) => p.id);
    expect(ids).toEqual(["mode", "count", "radius", "noiseAmount", "noiseScale"]);
    expect(ids).not.toContain("latticeResolution");
  });

  test("audio 入力ポートを持つ（noise の bass 反応用・任意）", () => {
    expect(PointShapeNode.inputs.find((p) => p.id === "audio")?.type).toBe("audio");
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
