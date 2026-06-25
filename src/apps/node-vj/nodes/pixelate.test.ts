import { expect, test, describe } from "bun:test";
import { PixelateNode, pixelateBlocks } from "./PixelateNode";
import { createDefaultRegistry } from "./registry";
import type { EvalContext } from "../graph/node-type";

const noCtx: EvalContext = {
  timeSec: 0, input: () => undefined, param: () => undefined,
  node: { id: "x", type: "Pixelate", params: {} },
};

describe("PixelateNode (#190)", () => {
  test("texture→texture の effect ノード", () => {
    expect(PixelateNode.inputs.map((p) => p.type)).toEqual(["texture"]);
    expect(PixelateNode.outputs.map((p) => p.type)).toEqual(["texture"]);
    expect(PixelateNode.category).toBe("effect");
    expect(PixelateNode.isSink).toBe(true);
    expect(PixelateNode.evaluate(noCtx)).toEqual({}); // state/env なしは no-op
  });

  test("params: enabled + blockSize/posterize", () => {
    expect(PixelateNode.params.map((p) => p.id)).toEqual([
      "enabled", "blockSize", "posterize",
    ]);
    expect(PixelateNode.params.find((p) => p.id === "enabled")?.default).toBe("on");
  });

  test("registry に登録されている", () => {
    expect(createDefaultRegistry().get("Pixelate")).toBeDefined();
  });
});

describe("pixelateBlocks", () => {
  test("画面サイズ / blockSize でブロック数を出す", () => {
    expect(pixelateBlocks(640, 480, 16)).toEqual({ x: 40, y: 30 });
  });

  test("blockSize が画面より大きくても 1 ブロック以上", () => {
    const b = pixelateBlocks(100, 100, 10000);
    expect(b.x).toBeGreaterThanOrEqual(1);
    expect(b.y).toBeGreaterThanOrEqual(1);
  });

  test("blockSize <= 0 でも 0 除算しない", () => {
    const b = pixelateBlocks(640, 480, 0);
    expect(Number.isFinite(b.x)).toBe(true);
    expect(Number.isFinite(b.y)).toBe(true);
  });
});
