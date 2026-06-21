import { expect, test, describe } from "bun:test";
import { DistortNode, distortModeInt } from "./DistortNode";
import { createDefaultRegistry } from "./registry";
import type { EvalContext } from "../graph/node-type";

const noCtx: EvalContext = {
  timeSec: 0, input: () => undefined, param: () => undefined,
  node: { id: "x", type: "Distort", params: {} },
};

describe("DistortNode (#149)", () => {
  test("texture→texture の effect ノード", () => {
    expect(DistortNode.inputs.map((p) => p.type)).toEqual(["texture"]);
    expect(DistortNode.outputs.map((p) => p.type)).toEqual(["texture"]);
    expect(DistortNode.category).toBe("effect");
    expect(DistortNode.evaluate(noCtx)).toEqual({});   // state/env なしは no-op
  });

  test("params: enabled + mode + amount/center/radius/mix", () => {
    expect(DistortNode.params.map((p) => p.id)).toEqual([
      "enabled", "mode", "amount", "centerX", "centerY", "radius", "mix",
    ]);
    const en = DistortNode.params.find((p) => p.id === "enabled");
    expect(en?.default).toBe("on");
  });

  test("mode enum は fisheye/twist/wave", () => {
    const mode = DistortNode.params.find((p) => p.id === "mode");
    expect(mode?.kind).toBe("enum");
    expect(mode?.options).toEqual(["fisheye", "twist", "wave"]);
  });

  test("amount は魚眼/逆歪みを符号で兼ねる（負値可）", () => {
    const a = DistortNode.params.find((p) => p.id === "amount");
    expect(a?.min).toBeLessThan(0);
    expect(a?.max).toBeGreaterThan(0);
  });

  test("distortModeInt: fisheye=0 twist=1 wave=2（未知=0）", () => {
    expect(distortModeInt("fisheye")).toBe(0);
    expect(distortModeInt("twist")).toBe(1);
    expect(distortModeInt("wave")).toBe(2);
    expect(distortModeInt("???")).toBe(0);
  });

  test("registry に登録されている", () => {
    expect(createDefaultRegistry().get("Distort")).toBeDefined();
  });
});
