import { expect, test, describe } from "bun:test";
import { FeedbackNode } from "./FeedbackNode";
import { createDefaultRegistry } from "./registry";
import type { EvalContext } from "../graph/node-type";

const noCtx: EvalContext = {
  timeSec: 0, input: () => undefined, param: () => undefined,
  node: { id: "x", type: "Feedback", params: {} },
};

describe("FeedbackNode (#156)", () => {
  test("texture→texture の effect ノード", () => {
    expect(FeedbackNode.inputs.map((p) => p.type)).toEqual(["texture"]);
    expect(FeedbackNode.outputs.map((p) => p.type)).toEqual(["texture"]);
    expect(FeedbackNode.category).toBe("effect");
    expect(FeedbackNode.evaluate(noCtx)).toEqual({});   // state/env なしは no-op
  });

  test("params: enabled + decay/offset/scale/rotate", () => {
    expect(FeedbackNode.params.map((p) => p.id)).toEqual([
      "enabled", "decay", "offsetX", "offsetY", "scale", "rotate",
    ]);
    expect(FeedbackNode.params.find((p) => p.id === "enabled")?.default).toBe("on");
    const decay = FeedbackNode.params.find((p) => p.id === "decay");
    expect(decay?.min).toBe(0);
    expect(decay?.max).toBe(1);
  });

  test("registry に登録されている", () => {
    expect(createDefaultRegistry().get("Feedback")).toBeDefined();
  });
});
