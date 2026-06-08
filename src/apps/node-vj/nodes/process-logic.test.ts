import { expect, test, describe } from "bun:test";
import { remap } from "./process-logic";

describe("remap", () => {
  test("基本の線形変換", () => {
    expect(remap(0.5, 0, 1, 0, 10, false)).toBe(5);
    expect(remap(0, 0, 1, 2, 4, false)).toBe(2);
    expect(remap(1, 0, 1, 2, 4, false)).toBe(4);
  });

  test("範囲外は clamp=false で外挿、clamp=true で収める", () => {
    expect(remap(2, 0, 1, 0, 10, false)).toBe(20);
    expect(remap(2, 0, 1, 0, 10, true)).toBe(10);
    expect(remap(-1, 0, 1, 0, 10, true)).toBe(0);
  });

  test("out 範囲が逆向きでも clamp する", () => {
    expect(remap(5, 0, 1, 10, 0, true)).toBe(0);   // 外挿 -40 → clamp 0
    expect(remap(0.5, 0, 1, 10, 0, false)).toBe(5);
  });

  test("退化範囲は outMin", () => {
    expect(remap(3, 1, 1, 7, 9, false)).toBe(7);
  });

  test("motion 0..0.3 → 0.1..1.5 の増幅例", () => {
    expect(remap(0, 0, 0.3, 0.1, 1.5, true)).toBeCloseTo(0.1, 6);
    expect(remap(0.3, 0, 0.3, 0.1, 1.5, true)).toBeCloseTo(1.5, 6);
    expect(remap(0.15, 0, 0.3, 0.1, 1.5, true)).toBeCloseTo(0.8, 6);
  });
});
