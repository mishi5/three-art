import { describe, expect, test } from "bun:test";
import { binIndexToX, expectedRainSpeed } from "./rain";

describe("binIndexToX", () => {
  test("最小 bin は -areaWidth/2 付近", () => {
    expect(binIndexToX(0, 8, 2.0)).toBeCloseTo(-1.0, 5);
  });

  test("最大 bin は +areaWidth/2", () => {
    expect(binIndexToX(7, 8, 2.0)).toBeCloseTo(1.0, 5);
  });

  test("中央 bin は 0 付近", () => {
    expect(binIndexToX(4, 9, 2.0)).toBeCloseTo(0, 5);
  });

  test("fftLen=1 のときは 0 を返す (0 除算ガード)", () => {
    expect(binIndexToX(0, 1, 2.0)).toBe(0);
  });
});

describe("expectedRainSpeed", () => {
  test("振幅 0 のとき baseSpeed と一致", () => {
    expect(expectedRainSpeed(0.5, 4.0, 0)).toBeCloseTo(0.5, 5);
  });

  test("振幅 1 のとき baseSpeed + ampGain", () => {
    expect(expectedRainSpeed(0.5, 4.0, 1)).toBeCloseTo(4.5, 5);
  });

  test("振幅 0.5 のとき線形補間", () => {
    expect(expectedRainSpeed(0.5, 4.0, 0.5)).toBeCloseTo(2.5, 5);
  });
});
