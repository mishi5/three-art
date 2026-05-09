import { describe, expect, test } from "bun:test";
import { clampSeek } from "./FileAudioSource";

describe("clampSeek", () => {
  test("0..duration の範囲はそのまま (epsilon 引いた上限)", () => {
    expect(clampSeek(0, 10)).toBe(0);
    expect(clampSeek(5, 10)).toBe(5);
  });

  test("負値は 0 に clamp", () => {
    expect(clampSeek(-1, 10)).toBe(0);
    expect(clampSeek(-Infinity, 10)).toBe(0);
  });

  test("duration 超えは duration - epsilon に clamp", () => {
    const r = clampSeek(20, 10);
    expect(r).toBeGreaterThan(9.9);
    expect(r).toBeLessThan(10);
  });

  test("NaN/Infinity は 0 に倒す", () => {
    expect(clampSeek(NaN, 10)).toBe(0);
    expect(clampSeek(Infinity, 10)).toBeLessThan(10);
  });

  test("duration が 0 以下なら 0 を返す", () => {
    expect(clampSeek(5, 0)).toBe(0);
    expect(clampSeek(5, -1)).toBe(0);
  });
});
