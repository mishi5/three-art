import { expect, test, describe } from "bun:test";
import { KeyNode, keyModeInt } from "./KeyNode";
import { createDefaultRegistry } from "./registry";
import type { EvalContext } from "../graph/node-type";

const noCtx: EvalContext = {
  timeSec: 0, input: () => undefined, param: () => undefined,
  node: { id: "x", type: "Key", params: {} },
};

describe("KeyNode (#157)", () => {
  test("fg/bg の 2 texture 入力・texture 出力（合成コンポジタ）", () => {
    expect(KeyNode.inputs.map((p) => p.id)).toEqual(["fg", "bg"]);
    expect(KeyNode.inputs.map((p) => p.type)).toEqual(["texture", "texture"]);
    expect(KeyNode.outputs.map((p) => p.type)).toEqual(["texture"]);
    expect(KeyNode.evaluate(noCtx)).toEqual({});   // state/env なしは no-op
  });

  test("mode enum は chroma/luma", () => {
    const mode = KeyNode.params.find((p) => p.id === "mode");
    expect(mode?.kind).toBe("enum");
    expect(mode?.options).toEqual(["chroma", "luma"]);
  });

  test("params: mode + キー色RGB + threshold/softness/spill/invert", () => {
    expect(KeyNode.params.map((p) => p.id)).toEqual([
      "mode", "keyR", "keyG", "keyB", "threshold", "softness", "spill", "invert",
    ]);
  });

  test("keyModeInt: chroma=0 luma=1（未知=0）", () => {
    expect(keyModeInt("chroma")).toBe(0);
    expect(keyModeInt("luma")).toBe(1);
    expect(keyModeInt("???")).toBe(0);
  });

  test("registry に登録されている", () => {
    expect(createDefaultRegistry().get("Key")).toBeDefined();
  });
});
