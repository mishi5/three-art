import { expect, test, describe } from "bun:test";
import { ColorGradeNode } from "./ColorGradeNode";
import { createDefaultRegistry } from "./registry";
import type { EvalContext } from "../graph/node-type";

const noCtx: EvalContext = {
  timeSec: 0, input: () => undefined, param: () => undefined,
  node: { id: "x", type: "ColorGrade", params: {} },
};

describe("ColorGradeNode (#191)", () => {
  test("texture→texture の effect ノード", () => {
    expect(ColorGradeNode.inputs.map((p) => p.type)).toEqual(["texture"]);
    expect(ColorGradeNode.outputs.map((p) => p.type)).toEqual(["texture"]);
    expect(ColorGradeNode.category).toBe("effect");
    expect(ColorGradeNode.isSink).toBe(true);
    expect(ColorGradeNode.evaluate(noCtx)).toEqual({}); // state/env なしは no-op
  });

  test("params: enabled + hueShift/saturation/brightness/contrast", () => {
    expect(ColorGradeNode.params.map((p) => p.id)).toEqual([
      "enabled", "hueShift", "saturation", "brightness", "contrast",
    ]);
    expect(ColorGradeNode.params.find((p) => p.id === "enabled")?.default).toBe("on");
  });

  test("saturation/brightness/contrast は既定 1（恒等）", () => {
    for (const id of ["saturation", "brightness", "contrast"]) {
      expect(ColorGradeNode.params.find((p) => p.id === id)?.default).toBe(1);
    }
    expect(ColorGradeNode.params.find((p) => p.id === "hueShift")?.default).toBe(0);
  });

  test("registry に登録されている", () => {
    expect(createDefaultRegistry().get("ColorGrade")).toBeDefined();
  });
});
