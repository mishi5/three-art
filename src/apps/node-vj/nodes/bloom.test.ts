import { expect, test, describe } from "bun:test";
import { BloomNode } from "./BloomNode";
import { createDefaultRegistry } from "./registry";
import type { EvalContext } from "../graph/node-type";

const noCtx: EvalContext = {
  timeSec: 0, input: () => undefined, param: () => undefined,
  node: { id: "x", type: "Bloom", params: {} },
};

describe("BloomNode (#188)", () => {
  test("texture→texture の effect ノード", () => {
    expect(BloomNode.inputs.map((p) => p.type)).toEqual(["texture"]);
    expect(BloomNode.outputs.map((p) => p.type)).toEqual(["texture"]);
    expect(BloomNode.category).toBe("effect");
    expect(BloomNode.isSink).toBe(true);
    expect(BloomNode.evaluate(noCtx)).toEqual({}); // state/env なしは no-op
  });

  test("params: enabled + threshold/intensity/radius", () => {
    expect(BloomNode.params.map((p) => p.id)).toEqual([
      "enabled", "threshold", "intensity", "radius",
    ]);
    expect(BloomNode.params.find((p) => p.id === "enabled")?.default).toBe("on");
  });

  test("threshold/intensity は非負レンジ", () => {
    const th = BloomNode.params.find((p) => p.id === "threshold");
    expect(th?.min).toBeGreaterThanOrEqual(0);
    const it = BloomNode.params.find((p) => p.id === "intensity");
    expect(it?.min).toBeGreaterThanOrEqual(0);
    expect(it?.max).toBeGreaterThan(0);
  });

  test("registry に登録されている", () => {
    expect(createDefaultRegistry().get("Bloom")).toBeDefined();
  });
});
