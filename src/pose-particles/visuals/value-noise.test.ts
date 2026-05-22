import { describe, expect, test } from "bun:test";
import { noise3D } from "./value-noise";

describe("noise3D", () => {
  test("range is within [-1, 1]", () => {
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < 5000; i++) {
      const x = i * 0.137;
      const y = i * 0.241;
      const z = i * 0.353;
      const n = noise3D(x, y, z);
      if (n < min) min = n;
      if (n > max) max = n;
      expect(n).toBeGreaterThanOrEqual(-1);
      expect(n).toBeLessThanOrEqual(1);
    }
    // 十分大きなサンプルなら ±0.3 以上は到達する (常時 0 ではない)
    expect(max).toBeGreaterThan(0.3);
    expect(min).toBeLessThan(-0.3);
  });

  test("deterministic: same input gives same output", () => {
    expect(noise3D(1.2, 3.4, 5.6)).toBe(noise3D(1.2, 3.4, 5.6));
    expect(noise3D(0, 0, 0)).toBe(noise3D(0, 0, 0));
  });

  test("continuous: small input perturbation produces small output change", () => {
    const a = noise3D(2.0, 1.5, 0.7);
    const b = noise3D(2.001, 1.5, 0.7);
    expect(Math.abs(a - b)).toBeLessThan(0.05);
  });

  test("non-trivial: noise3D(x, y, z) varies with each axis", () => {
    const base = noise3D(0.3, 0.3, 0.3);
    const dx = noise3D(2.0, 0.3, 0.3);
    const dy = noise3D(0.3, 2.0, 0.3);
    const dz = noise3D(0.3, 0.3, 2.0);
    expect(dx).not.toBeCloseTo(base, 3);
    expect(dy).not.toBeCloseTo(base, 3);
    expect(dz).not.toBeCloseTo(base, 3);
  });
});
