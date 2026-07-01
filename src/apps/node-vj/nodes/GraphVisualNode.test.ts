import { expect, test, describe } from "bun:test";
import { GraphVisualNode } from "./GraphVisualNode";
import { createDefaultRegistry } from "./registry";
import type { EvalContext } from "../graph/node-type";

function ctxNoState(over: Partial<EvalContext> = {}): EvalContext {
  return {
    timeSec: 0,
    input: () => undefined,
    param: () => undefined,
    node: { id: "x", type: "GraphVisual", params: {} },
    ...over,
  };
}

describe("GraphVisualNode (#217)", () => {
  test("visual カテゴリ・sink・value(number) 入力・texture 出力", () => {
    expect(GraphVisualNode.type).toBe("GraphVisual");
    expect(GraphVisualNode.category).toBe("visual");
    expect(GraphVisualNode.isSink).toBe(true);
    expect(GraphVisualNode.inputs.map((p) => p.id)).toEqual(["value"]);
    expect(GraphVisualNode.inputs[0]?.type).toBe("number");
    expect(GraphVisualNode.outputs.map((p) => p.id)).toEqual(["texture"]);
    expect(GraphVisualNode.outputs[0]?.type).toBe("texture");
  });

  test("params は windowSec/yMin/yMax/lineWidth/r/g/b/bgAlpha/zeroLine", () => {
    expect(GraphVisualNode.params.map((p) => p.id)).toEqual([
      "windowSec", "yMin", "yMax", "lineWidth", "r", "g", "b", "bgAlpha", "zeroLine",
    ]);
  });

  test("windowSec は 0.25..30 の number（既定 4）", () => {
    const p = GraphVisualNode.params.find((q) => q.id === "windowSec");
    expect(p?.kind).toBe("number");
    expect(p?.default).toBe(4);
    expect(p?.min).toBe(0.25);
    expect(p?.max).toBe(30);
  });

  test("yMin/yMax の既定は -1 / 1", () => {
    expect(GraphVisualNode.params.find((q) => q.id === "yMin")?.default).toBe(-1);
    expect(GraphVisualNode.params.find((q) => q.id === "yMax")?.default).toBe(1);
  });

  test("zeroLine は enum off/on（既定 on）", () => {
    const p = GraphVisualNode.params.find((q) => q.id === "zeroLine");
    expect(p?.kind).toBe("enum");
    expect(p?.options).toEqual(["off", "on"]);
    expect(p?.default).toBe("on");
  });

  test("state/env 無しは空オブジェクト（安全）", () => {
    expect(GraphVisualNode.evaluate(ctxNoState())).toEqual({});
    // value 未接続でも例外を投げない。
    expect(() => GraphVisualNode.evaluate(ctxNoState({ input: () => undefined }))).not.toThrow();
  });

  test("registry に登録されている", () => {
    expect(createDefaultRegistry().get("GraphVisual")).toBeDefined();
  });
});
