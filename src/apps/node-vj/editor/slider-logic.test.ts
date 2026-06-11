import { expect, test, describe } from "bun:test";
import { absoluteSliderValue, scrubValue, fillRatio, isAbsoluteSlider } from "./slider-logic";
import type { ParamDef } from "../graph/node-type";

const radius: ParamDef = { id: "radius", label: "", kind: "number", default: 0.4, min: 0.05, max: 3, step: 0.01 };
const count: ParamDef = { id: "count", label: "", kind: "int", default: 2000, min: 16, max: 8000, step: 1 };
const free: ParamDef = { id: "a", label: "", kind: "number", default: 1, step: 0.1 }; // min/max なし

describe("absoluteSliderValue", () => {
  test("行内位置を min..max に線形対応（step スナップ）", () => {
    expect(absoluteSliderValue(0, 0, 100, radius)).toBeCloseTo(0.05, 6);   // 左端=min
    expect(absoluteSliderValue(100, 0, 100, radius)).toBeCloseTo(3, 6);    // 右端=max
    const mid = absoluteSliderValue(50, 0, 100, radius);
    expect(mid).toBeCloseTo(1.53, 2); // (0.05+3)/2≒1.525 → 0.01 スナップ
  });

  test("行外は clamp", () => {
    expect(absoluteSliderValue(-20, 0, 100, radius)).toBeCloseTo(0.05, 6);
    expect(absoluteSliderValue(140, 0, 100, radius)).toBeCloseTo(3, 6);
  });

  test("int は整数に", () => {
    const v = absoluteSliderValue(33, 0, 100, count);
    expect(Number.isInteger(v)).toBe(true);
    expect(v).toBeGreaterThanOrEqual(16);
    expect(v).toBeLessThanOrEqual(8000);
  });
});

describe("scrubValue", () => {
  test("dx × step で増減", () => {
    expect(scrubValue(1, 10, free)).toBeCloseTo(2, 6);   // +10px × 0.1
    expect(scrubValue(1, -5, free)).toBeCloseTo(0.5, 6);
  });

  test("min/max があれば clamp", () => {
    expect(scrubValue(2.9, 100, radius)).toBeCloseTo(3, 6);
    expect(scrubValue(0.1, -100, radius)).toBeCloseTo(0.05, 6);
  });
});

describe("fillRatio / isAbsoluteSlider", () => {
  test("min/max ありは 0..1 の割合", () => {
    expect(fillRatio(0.05, radius)).toBeCloseTo(0, 6);
    expect(fillRatio(3, radius)).toBeCloseTo(1, 6);
    expect(fillRatio(10, radius)).toBe(1); // clamp
  });

  test("min/max なしは null / isAbsoluteSlider false", () => {
    expect(fillRatio(1, free)).toBeNull();
    expect(isAbsoluteSlider(free)).toBe(false);
    expect(isAbsoluteSlider(radius)).toBe(true);
  });
});
