import { describe, expect, test } from "bun:test";
import { clampSeek, computeCurrentTime } from "./FileAudioSource";

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

describe("computeCurrentTime", () => {
  test("stopped は 0", () => {
    expect(computeCurrentTime("stopped", 0, null, 5, 100)).toBe(0);
  });

  test("paused は playOffset を返す", () => {
    expect(computeCurrentTime("paused", 12.5, null, 99, 100)).toBe(12.5);
  });

  test("playing は (playOffset + (ctxNow - startedAt)) % duration", () => {
    // playOffset=10, startedAt=2, ctxNow=5  → 10 + 3 = 13、duration 100 で wrap せず 13
    expect(computeCurrentTime("playing", 10, 2, 5, 100)).toBe(13);
  });

  test("playing で duration を超えたら wrap する", () => {
    // playOffset=98, startedAt=0, ctxNow=5, duration=100 → 103 % 100 = 3
    expect(computeCurrentTime("playing", 98, 0, 5, 100)).toBeCloseTo(3, 6);
  });

  test("playing で startedAt が null なら 0", () => {
    expect(computeCurrentTime("playing", 5, null, 10, 100)).toBe(0);
  });

  test("playing で duration<=0 なら 0", () => {
    expect(computeCurrentTime("playing", 5, 0, 10, 0)).toBe(0);
  });
});
