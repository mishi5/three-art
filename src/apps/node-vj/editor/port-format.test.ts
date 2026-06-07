import { expect, test, describe } from "bun:test";
import { formatPortValue } from "./port-format";

describe("formatPortValue", () => {
  test("number: 整数はそのまま、小数は3桁", () => {
    expect(formatPortValue(5, "number")).toBe("5");
    expect(formatPortValue(0.05, "number")).toBe("0.050");
    expect(formatPortValue(0.4, "number")).toBe("0.400");
  });

  test("number: 非数値や無限は空", () => {
    expect(formatPortValue(undefined, "number")).toBe("");
    expect(formatPortValue(Infinity, "number")).toBe("");
    expect(formatPortValue("x", "number")).toBe("");
  });

  test("trigger: 真偽で記号", () => {
    expect(formatPortValue(true, "trigger")).toBe("▮");
    expect(formatPortValue(false, "trigger")).toBe("▯");
  });

  test("vec/color は配列を整形", () => {
    expect(formatPortValue([1, 2, 3], "vec3")).toBe("[1.00,2.00,3.00]");
    expect(formatPortValue([0.5, 0.25], "vec2")).toBe("[0.50,0.25]");
  });

  test("pose/audio/texture は型名ラベル", () => {
    expect(formatPortValue({}, "pose")).toBe("pose");
    expect(formatPortValue({}, "audio")).toBe("audio");
    expect(formatPortValue({}, "texture")).toBe("tex");
  });

  test("null/undefined は空", () => {
    expect(formatPortValue(null, "pose")).toBe("");
    expect(formatPortValue(undefined, "audio")).toBe("");
  });
});
