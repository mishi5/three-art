import { describe, expect, test } from "bun:test";
import {
  applyMotionToBlur,
  effectiveBlurStrength,
  makeDefaultBlur,
  type BlurSettings,
} from "./blur";

const defaultBlur: BlurSettings = {
  enabled: true,
  strength: 4.0,
  iterations: 2,
  bassDrive: 0.0,
};

describe("makeDefaultBlur", () => {
  test("disabled by default with sensible numeric defaults", () => {
    const b = makeDefaultBlur();
    expect(b.enabled).toBe(false);
    expect(b.strength).toBeGreaterThan(0);
    expect(b.iterations).toBeGreaterThanOrEqual(1);
    expect(b.bassDrive).toBe(0);
  });
});

describe("effectiveBlurStrength", () => {
  test("enabled=false yields 0 even with bass and drive", () => {
    const off: BlurSettings = { ...defaultBlur, enabled: false, strength: 10, bassDrive: 2 };
    expect(effectiveBlurStrength(off, 0.5)).toBe(0);
  });

  test("no bassDrive returns plain strength", () => {
    const b: BlurSettings = { ...defaultBlur, strength: 3.0, bassDrive: 0 };
    expect(effectiveBlurStrength(b, 0.9)).toBe(3.0);
  });

  test("bassDrive boosts strength multiplicatively", () => {
    const b: BlurSettings = { ...defaultBlur, strength: 4.0, bassDrive: 2.0 };
    expect(effectiveBlurStrength(b, 0.5)).toBeCloseTo(8.0, 6);
  });

  test("zero bass returns plain strength regardless of drive", () => {
    const b: BlurSettings = { ...defaultBlur, strength: 5.0, bassDrive: 3.0 };
    expect(effectiveBlurStrength(b, 0)).toBe(5.0);
  });
});

describe("applyMotionToBlur", () => {
  test("multiplies strength by factor, leaves other fields", () => {
    const b: BlurSettings = { ...defaultBlur, strength: 2.0, iterations: 3, bassDrive: 1.0, enabled: true };
    applyMotionToBlur(b, 1.5);
    expect(b.strength).toBeCloseTo(3.0, 6);
    expect(b.iterations).toBe(3);
    expect(b.bassDrive).toBe(1.0);
    expect(b.enabled).toBe(true);
  });
});
