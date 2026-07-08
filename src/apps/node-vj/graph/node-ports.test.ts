import { expect, test, describe } from "bun:test";
import {
  paramInputs, signalInputs, effectiveInputPorts, isParamInput, isNumericParam,
  firstCompatibleInput, compatibleNodeTypes,
} from "./node-ports";
import type { NodeTypeDef } from "./node-type";

// Multiply 風: 宣言入力 a/b（数値 param a/b と同 id）
const multiply: NodeTypeDef = {
  type: "Multiply",
  inputs: [{ id: "a", label: "a", type: "number" }, { id: "b", label: "b", type: "number" }],
  outputs: [{ id: "out", label: "out", type: "number" }],
  params: [
    { id: "a", label: "a", kind: "number", default: 1 },
    { id: "b", label: "b", kind: "number", default: 1 },
  ],
  evaluate: () => ({}),
};

// 視覚ノード風: signal(pose/audio) + 数値 param + enum param
const visual: NodeTypeDef = {
  type: "V",
  inputs: [{ id: "pose", label: "pose", type: "pose" }, { id: "audio", label: "audio", type: "audio" }],
  outputs: [],
  params: [
    { id: "mode", label: "mode", kind: "enum", default: "cube", options: ["cube"] },
    { id: "radius", label: "radius", kind: "number", default: 0.4 },
    { id: "res", label: "res", kind: "int", default: 12 },
    { id: "flag", label: "flag", kind: "boolean", default: true },
  ],
  evaluate: () => ({}),
};

describe("node-ports 分類", () => {
  test("paramInputs は数値 param のみ", () => {
    expect(paramInputs(visual).map((p) => p.id)).toEqual(["radius", "res"]);
    expect(paramInputs(visual).every((p) => p.type === "number")).toBe(true);
  });

  test("signalInputs は param を持たない宣言入力のみ", () => {
    expect(signalInputs(visual).map((p) => p.id)).toEqual(["pose", "audio"]);
    // Multiply の a/b は param と同 id → signal から除外
    expect(signalInputs(multiply).map((p) => p.id)).toEqual([]);
  });

  test("effectiveInputPorts は signal ∪ param（重複なし）", () => {
    expect(effectiveInputPorts(visual).map((p) => p.id)).toEqual(["pose", "audio", "radius", "res"]);
    // Multiply は a/b が param 由来で 1 回ずつ
    expect(effectiveInputPorts(multiply).map((p) => p.id)).toEqual(["a", "b"]);
  });

  test("isParamInput", () => {
    expect(isParamInput(visual, "radius")).toBe(true);
    expect(isParamInput(visual, "mode")).toBe(false);   // enum
    expect(isParamInput(visual, "pose")).toBe(false);   // signal
    expect(isParamInput(multiply, "a")).toBe(true);
  });

  test("isNumericParam", () => {
    expect(isNumericParam({ id: "x", label: "", kind: "number", default: 0 })).toBe(true);
    expect(isNumericParam({ id: "x", label: "", kind: "int", default: 0 })).toBe(true);
    expect(isNumericParam({ id: "x", label: "", kind: "enum", default: "" })).toBe(false);
  });

  test("noInput な数値 param は入力ポートを持たない（Number.value 等）", () => {
    const fixed: NodeTypeDef = {
      type: "Fixed",
      inputs: [],
      outputs: [{ id: "out", label: "n", type: "number" }],
      params: [{ id: "value", label: "Value", kind: "number", default: 1, noInput: true }],
      evaluate: () => ({}),
    };
    expect(paramInputs(fixed)).toEqual([]);
    expect(effectiveInputPorts(fixed)).toEqual([]);
    expect(isParamInput(fixed, "value")).toBe(false);
  });
});

// #258: エッジドロップ（出力ポート起点）の互換ノード判定と自動接続先の決定。
describe("firstCompatibleInput (#258)", () => {
  test("宣言入力（signal）から最初の互換ポートを返す", () => {
    expect(firstCompatibleInput(visual, "pose")?.id).toBe("pose");
    expect(firstCompatibleInput(visual, "audio")?.id).toBe("audio");
  });

  test("数値 param の自動入力ポート化（paramInputs）も接続先とみなす", () => {
    // visual の number 互換は param 由来の radius（宣言入力 pose/audio は不一致）。
    expect(firstCompatibleInput(visual, "number")?.id).toBe("radius");
    // Multiply は a/b が param 由来 → 最初の a。
    expect(firstCompatibleInput(multiply, "number")?.id).toBe("a");
  });

  test("互換入力が無ければ undefined", () => {
    expect(firstCompatibleInput(visual, "texture")).toBeUndefined();
    expect(firstCompatibleInput(multiply, "pose")).toBeUndefined();
  });

  test("noInput な数値 param は接続先にならない", () => {
    const fixed: NodeTypeDef = {
      type: "Fixed",
      inputs: [],
      outputs: [{ id: "out", label: "n", type: "number" }],
      params: [{ id: "value", label: "Value", kind: "number", default: 1, noInput: true }],
      evaluate: () => ({}),
    };
    expect(firstCompatibleInput(fixed, "number")).toBeUndefined();
  });
});

describe("compatibleNodeTypes (#258)", () => {
  const fixed: NodeTypeDef = {
    type: "Fixed",
    inputs: [],
    outputs: [{ id: "out", label: "n", type: "number" }],
    params: [{ id: "value", label: "Value", kind: "number", default: 1, noInput: true }],
    evaluate: () => ({}),
  };
  const defs = [multiply, visual, fixed];

  test("互換な入力ポート（param 入力含む）を持つ型のみ返す（定義順を維持）", () => {
    expect(compatibleNodeTypes(defs, "number")).toEqual(["Multiply", "V"]);
    expect(compatibleNodeTypes(defs, "pose")).toEqual(["V"]);
  });

  test("互換ノードが無ければ空配列", () => {
    expect(compatibleNodeTypes(defs, "texture")).toEqual([]);
  });

  test("空定義なら空配列", () => {
    expect(compatibleNodeTypes([], "number")).toEqual([]);
  });
});
