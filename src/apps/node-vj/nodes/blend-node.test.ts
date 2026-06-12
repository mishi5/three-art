import { expect, test, describe } from "bun:test";
import { blendModeToFloat, BLEND_MODES } from "./blend-logic";
import { BlendNode } from "./BlendNode";
import { createDefaultRegistry } from "./registry";

describe("blend-logic", () => {
  test("mode → uMode 値", () => {
    expect(blendModeToFloat("normal")).toBe(0);
    expect(blendModeToFloat("add")).toBe(1);
    expect(blendModeToFloat("multiply")).toBe(2);
    expect(blendModeToFloat("screen")).toBe(3);
    expect(blendModeToFloat("???")).toBe(0); // 未知は normal
  });
});

describe("BlendNode", () => {
  test("ポート/param 定義", () => {
    expect(BlendNode.inputs.map((p) => `${p.id}:${p.type}`)).toEqual(["a:texture", "b:texture"]);
    expect(BlendNode.outputs.map((p) => p.type)).toEqual(["texture"]);
    const mode = BlendNode.params.find((p) => p.id === "mode");
    expect(mode?.options).toEqual([...BLEND_MODES]);
    expect(BlendNode.params.find((p) => p.id === "mix")?.kind).toBe("number");
    expect(BlendNode.category).toBe("visual"); // 終端で自動表示・👁 対象
  });

  test("state/env 無しでは no-op", () => {
    const out = BlendNode.evaluate({
      timeSec: 0, input: () => undefined, param: () => undefined,
      node: { id: "x", type: "Blend", params: {} },
    });
    expect(out).toEqual({});
  });

  test("registry に登録されている", () => {
    expect(createDefaultRegistry().get("Blend")).toBe(BlendNode);
  });
});
