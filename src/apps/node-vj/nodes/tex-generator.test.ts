import { expect, test, describe } from "bun:test";
import { TexGeneratorNode, texGenModeInt } from "./TexGeneratorNode";
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

describe("TexGeneratorNode (#153)", () => {
  test("generator カテゴリ・入力なし・texture を出力", () => {
    expect(TexGeneratorNode.type).toBe("TexGenerator");
    expect(TexGeneratorNode.category).toBe("generator");
    expect(TexGeneratorNode.inputs).toEqual([]);
    expect(TexGeneratorNode.outputs.map((p) => p.id)).toEqual(["texture"]);
    expect(TexGeneratorNode.outputs[0]?.type).toBe("texture");
  });

  test("mode enum は solid/linear/radial", () => {
    const mode = TexGeneratorNode.params.find((p) => p.id === "mode");
    expect(mode?.kind).toBe("enum");
    expect(mode?.options).toEqual(["solid", "linear", "radial"]);
  });

  test("色は RGB の number param（他ノードから駆動可能）＋ angle", () => {
    const ids = TexGeneratorNode.params.map((p) => p.id);
    expect(ids).toEqual(["mode", "r1", "g1", "b1", "r2", "g2", "b2", "angle"]);
    for (const id of ["r1", "g1", "b1", "r2", "g2", "b2"]) {
      const p = TexGeneratorNode.params.find((q) => q.id === id);
      expect(p?.kind).toBe("number");
      expect(p?.min).toBe(0);
      expect(p?.max).toBe(1);
    }
  });

  test("texGenModeInt: solid=0 linear=1 radial=2（未知は 1=linear）", () => {
    expect(texGenModeInt("solid")).toBe(0);
    expect(texGenModeInt("linear")).toBe(1);
    expect(texGenModeInt("radial")).toBe(2);
    expect(texGenModeInt("???")).toBe(1);
  });

  test("state/env 無しは空オブジェクト", () => {
    expect(TexGeneratorNode.evaluate(ctxNoState())).toEqual({});
  });

  test("registry に登録されている", () => {
    expect(createDefaultRegistry().get("TexGenerator")).toBeDefined();
  });
});
