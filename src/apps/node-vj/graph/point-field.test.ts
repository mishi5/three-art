import { expect, test, describe } from "bun:test";
import { fieldTexSize } from "./point-field";
import { PORT_TYPES, isCompatible } from "./port-types";

describe("points ポート型 (#101)", () => {
  test("PORT_TYPES に points が含まれる", () => {
    expect(PORT_TYPES).toContain("points");
  });
  test("points→points のみ接続可能（厳密一致）", () => {
    expect(isCompatible("points", "points")).toBe(true);
    expect(isCompatible("points", "texture")).toBe(false);
    expect(isCompatible("texture", "points")).toBe(false);
  });
});

describe("fieldTexSize (#101)", () => {
  test("texW=ceil(sqrt(count)) / texH=ceil(count/texW) で count を収容", () => {
    for (const count of [1, 4, 5, 16, 17, 100, 4096, 5000]) {
      const { w, h } = fieldTexSize(count);
      expect(w).toBeGreaterThanOrEqual(1);
      expect(h).toBeGreaterThanOrEqual(1);
      expect(w * h).toBeGreaterThanOrEqual(count);
      expect(w).toBe(Math.ceil(Math.sqrt(count)));
    }
  });
  test("完全平方は正方", () => {
    expect(fieldTexSize(16)).toEqual({ w: 4, h: 4 });
    expect(fieldTexSize(100)).toEqual({ w: 10, h: 10 });
  });
  test("count<=0 は 1x1（空でも RT を作れる最小サイズ）", () => {
    expect(fieldTexSize(0)).toEqual({ w: 1, h: 1 });
    expect(fieldTexSize(-3)).toEqual({ w: 1, h: 1 });
  });
});
