import { expect, test, describe } from "bun:test";
import { RgbShiftNode, RgbShiftRuntime } from "./RgbShiftNode";
import { createDefaultRegistry } from "./registry";
import type { EvalContext } from "../graph/node-type";

const noCtx: EvalContext = {
  timeSec: 0, input: () => undefined, param: () => undefined,
  node: { id: "x", type: "RgbShift", params: {} },
};

describe("RgbShiftNode (#189)", () => {
  test("texture(+trigger)→texture の effect ノード", () => {
    expect(RgbShiftNode.inputs.map((p) => p.type)).toEqual(["texture", "trigger"]);
    expect(RgbShiftNode.outputs.map((p) => p.type)).toEqual(["texture"]);
    expect(RgbShiftNode.category).toBe("effect");
    expect(RgbShiftNode.isSink).toBe(true);
    expect(RgbShiftNode.evaluate(noCtx)).toEqual({}); // state/env なしは no-op
  });

  test("params: enabled + amount/angle/triggerAmount/decay", () => {
    expect(RgbShiftNode.params.map((p) => p.id)).toEqual([
      "enabled", "amount", "angle", "triggerAmount", "decay",
    ]);
    expect(RgbShiftNode.params.find((p) => p.id === "enabled")?.default).toBe("on");
  });

  test("trigger 入力ポートの id は他ノードと揃えて trigger", () => {
    expect(RgbShiftNode.inputs.map((p) => p.id)).toEqual(["in", "trigger"]);
  });

  test("registry に登録されている", () => {
    expect(createDefaultRegistry().get("RgbShift")).toBeDefined();
  });
});

describe("RgbShiftRuntime", () => {
  test("立ち上がりエッジで triggerTime を記録し level は減衰する", () => {
    const r = new RgbShiftRuntime();
    expect(r.getLevel(0, 0.15)).toBe(0); // 未発火は 0
    r.feed(true, 1);
    expect(r.getLevel(1, 0.15)).toBeCloseTo(1, 5); // 発火直後はほぼ 1
    expect(r.getLevel(1.15, 0.15)).toBeCloseTo(0, 5); // decay 経過で 0
  });

  test("trigger を保持し続けても再発火しない（エッジ検出）", () => {
    const r = new RgbShiftRuntime();
    r.feed(true, 1);
    r.feed(true, 2); // 立ち上がりでないので triggerTime は更新されない
    expect(r.triggerTime).toBe(1);
  });
});
