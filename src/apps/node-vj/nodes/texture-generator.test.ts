import { expect, test, describe } from "bun:test";
import { TextureGeneratorNode, textureGenModeInt } from "./TextureGeneratorNode";
import { createDefaultRegistry } from "./registry";
import type { EvalContext } from "../graph/node-type";

function ctxNoState(over: Partial<EvalContext> = {}): EvalContext {
  return {
    timeSec: 0,
    input: () => undefined,
    param: () => undefined,
    node: { id: "x", type: "T", params: {} },
    ...over,
  };
}

describe("TextureGeneratorNode (#153)", () => {
  test("visual カテゴリ・入力なし・texture を出力", () => {
    expect(TextureGeneratorNode.type).toBe("TextureGenerator");
    expect(TextureGeneratorNode.category).toBe("visual");
    expect(TextureGeneratorNode.inputs).toEqual([]);
    expect(TextureGeneratorNode.outputs.map((p) => p.id)).toEqual(["texture"]);
    expect(TextureGeneratorNode.outputs[0]?.type).toBe("texture");
  });

  test("mode enum は solid/linear/radial", () => {
    const mode = TextureGeneratorNode.params.find((p) => p.id === "mode");
    expect(mode?.kind).toBe("enum");
    expect(mode?.options).toEqual(["solid", "linear", "radial"]);
  });

  test("色は RGB の number param（他ノードから駆動可能）＋ angle", () => {
    const ids = TextureGeneratorNode.params.map((p) => p.id);
    expect(ids).toEqual(["mode", "r1", "g1", "b1", "r2", "g2", "b2", "angle"]);
    for (const id of ["r1", "g1", "b1", "r2", "g2", "b2"]) {
      const p = TextureGeneratorNode.params.find((q) => q.id === id);
      expect(p?.kind).toBe("number");
      expect(p?.min).toBe(0);
      expect(p?.max).toBe(1);
    }
  });

  test("textureGenModeInt: solid=0 linear=1 radial=2（未知は 1=linear）", () => {
    expect(textureGenModeInt("solid")).toBe(0);
    expect(textureGenModeInt("linear")).toBe(1);
    expect(textureGenModeInt("radial")).toBe(2);
    expect(textureGenModeInt("???")).toBe(1);
  });

  test("state/env 無しは空オブジェクト", () => {
    expect(TextureGeneratorNode.evaluate(ctxNoState())).toEqual({});
  });

  test("registry に登録されている", () => {
    expect(createDefaultRegistry().get("TextureGenerator")).toBeDefined();
  });
});
