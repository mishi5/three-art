import { expect, test, describe } from "bun:test";
import { paramInputs, signalInputs, effectiveInputPorts, isParamInput, isNumericParam } from "./node-ports";
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
});
