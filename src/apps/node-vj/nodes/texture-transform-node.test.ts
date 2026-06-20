import { expect, test, describe } from "bun:test";
import { TextureTransformNode } from "./TextureTransformNode";
import { createDefaultRegistry } from "./registry";
import type { EvalContext } from "../graph/node-type";

const noCtx = (): EvalContext => ({
  timeSec: 0, input: () => undefined, param: () => undefined,
  node: { id: "x", type: "TextureTransform", params: {} },
});

describe("TextureTransformNode (#138)", () => {
  test("effect・texture→texture のポート定義", () => {
    expect(TextureTransformNode.type).toBe("TextureTransform");
    expect(TextureTransformNode.category).toBe("effect");
    expect(TextureTransformNode.inputs.map((p) => p.type)).toEqual(["texture"]);
    expect(TextureTransformNode.outputs.map((p) => p.type)).toEqual(["texture"]);
  });

  test("params: offset/scale/rotation/flip/wrap", () => {
    expect(TextureTransformNode.params.map((p) => p.id)).toEqual([
      "offsetX", "offsetY", "scaleX", "scaleY", "rotation", "flipX", "flipY", "wrap",
    ]);
    const wrap = TextureTransformNode.params.find((p) => p.id === "wrap");
    expect(wrap?.options).toEqual(["clamp", "repeat", "mirror", "none"]);
    const flipX = TextureTransformNode.params.find((p) => p.id === "flipX");
    expect(flipX?.default).toBe("off");
    expect(TextureTransformNode.params.find((p) => p.id === "scaleX")?.default).toBe(1);
  });

  test("state/env 無しは no-op（headless）", () => {
    expect(TextureTransformNode.evaluate(noCtx())).toEqual({});
  });

  test("レジストリに登録されている", () => {
    expect(createDefaultRegistry().get("TextureTransform")).toBeDefined();
  });
});
