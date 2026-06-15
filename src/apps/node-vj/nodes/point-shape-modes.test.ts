import { expect, test, describe } from "bun:test";
import { PointShapeNode, shapeCount, MAX_COUNT } from "./PointShapeNode";
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

  test("lattice 系 param（latticeResolution/noiseAmount/noiseScale）を持つ", () => {
    const ids = PointShapeNode.params.map((p) => p.id);
    for (const k of ["latticeResolution", "noiseAmount", "noiseScale"]) expect(ids).toContain(k);
  });

  test("audio 入力ポートを持つ（lattice の bass 反応用・任意）", () => {
    expect(PointShapeNode.inputs.find((p) => p.id === "audio")?.type).toBe("audio");
  });
});

describe("shapeCount (#104)", () => {
  test("lattice は N^3、cube/sphere は count", () => {
    expect(shapeCount("lattice", 4000, 12)).toBe(12 * 12 * 12);
    expect(shapeCount("cube", 4000, 12)).toBe(4000);
    expect(shapeCount("sphere", 2500, 12)).toBe(2500);
  });
  test("最小 1・上限 MAX_COUNT にクランプ", () => {
    expect(shapeCount("cube", 0, 12)).toBe(1);
    expect(shapeCount("cube", 999999, 12)).toBe(MAX_COUNT);
    expect(shapeCount("lattice", 0, 64)).toBe(MAX_COUNT); // 64^3 > MAX
  });
});

describe("PointShape evaluate no-op (#104)", () => {
  test("state/env 無しは空オブジェクト", () => {
    expect(PointShapeNode.evaluate(ctxNoState())).toEqual({});
  });
});
