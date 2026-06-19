import { expect, test, describe } from "bun:test";
import { PointCloudVisualNode } from "./PointCloudVisualNode";
import { createDefaultRegistry } from "./registry";

describe("PointCloudVisualNode", () => {
  test("pose/audio 入力ポートを持ち sink である", () => {
    expect(PointCloudVisualNode.isSink).toBe(true);
    expect(PointCloudVisualNode.inputs.map((p) => p.id)).toEqual(["pose", "signal"]);
    expect(PointCloudVisualNode.inputs.find((p) => p.id === "pose")?.type).toBe("pose");
    expect(PointCloudVisualNode.inputs.find((p) => p.id === "signal")?.type).toBe("signal");
  });

  test("mode enum に 5 モードを持つ", () => {
    const mode = PointCloudVisualNode.params.find((p) => p.id === "mode");
    expect(mode?.options).toEqual(["bones", "cube", "sphere", "lattice", "image"]);
  });

  test("state/env 無しでは no-op", () => {
    const out = PointCloudVisualNode.evaluate({
      timeSec: 0, input: () => undefined, param: () => undefined,
      node: { id: "x", type: "PointCloudVisual", params: {} },
    });
    expect(out).toEqual({});
  });

  test("registry に登録されている", () => {
    expect(createDefaultRegistry().get("PointCloudVisual")).toBe(PointCloudVisualNode);
  });
});
