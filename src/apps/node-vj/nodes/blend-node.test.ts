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
    // #280: 追加モード（既存 4 種の値は変えない＝保存済みグラフ互換）。
    expect(blendModeToFloat("overlay")).toBe(4);
    expect(blendModeToFloat("difference")).toBe(5);
    expect(blendModeToFloat("subtract")).toBe(6);
    expect(blendModeToFloat("darken")).toBe(7);
    expect(blendModeToFloat("lighten")).toBe(8);
    expect(blendModeToFloat("???")).toBe(0); // 未知は normal
  });

  test("#280: BLEND_MODES は全モードを列挙し blendModeToFloat と 1:1 対応する", () => {
    expect(BLEND_MODES).toEqual([
      "normal", "add", "multiply", "screen", "overlay", "difference", "subtract", "darken", "lighten",
    ]);
    // enum 定義順と uMode 値が一致（シェーダ if 連鎖の分岐順の取り違え防止）。
    BLEND_MODES.forEach((m, i) => expect(blendModeToFloat(m)).toBe(i));
  });
});

describe("BlendNode", () => {
  test("ポート/param 定義", () => {
    expect(BlendNode.inputs.map((p) => `${p.id}:${p.type}`)).toEqual(["a:texture", "b:texture"]);
    expect(BlendNode.outputs.map((p) => p.type)).toEqual(["texture"]);
    const mode = BlendNode.params.find((p) => p.id === "mode");
    expect(mode?.options).toEqual([...BLEND_MODES]);
    expect(BlendNode.params.find((p) => p.id === "mix")?.kind).toBe("number");
    expect(BlendNode.category).toBe("composite"); // #227: 合成系。終端で自動表示・👁 対象
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
