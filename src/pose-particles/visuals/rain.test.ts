import { describe, expect, test } from "bun:test";
import { expectedRainSpeed, mapBinIndex, stepDisplacement } from "./rain";

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

describe("mapBinIndex", () => {
  test("linear: 左端は bin 0、右端は最終 bin", () => {
    expect(mapBinIndex(0, 100, 1024, "linear")).toBe(0);
    expect(mapBinIndex(99, 100, 1024, "linear")).toBe(1023);
  });

  test("linear: 中央は中央 bin", () => {
    expect(mapBinIndex(50, 101, 1025, "linear")).toBe(512);
  });

  test("log: 左端は bin 0、右端は最終 bin", () => {
    expect(mapBinIndex(0, 100, 1024, "log")).toBe(0);
    expect(mapBinIndex(99, 100, 1024, "log")).toBe(1023);
  });

  test("log: 画面中央が低域に強く偏る (linear より遥かに小さい bin)", () => {
    const mid = mapBinIndex(50, 101, 1024, "log");
    // pow(1024, 0.5) - 1 = 31
    expect(mid).toBe(31);
    expect(mid).toBeLessThan(mapBinIndex(50, 101, 1024, "linear"));
  });

  test("fftLen<=1 / n<=1 は 0", () => {
    expect(mapBinIndex(5, 100, 1, "log")).toBe(0);
    expect(mapBinIndex(0, 1, 1024, "linear")).toBe(0);
  });
});

describe("stepDisplacement", () => {
  test("単純な前進", () => {
    expect(stepDisplacement(0, 1.0, 0.5, 2.0)).toBeCloseTo(0.5, 5);
  });

  test("areaHeight でラップしても 1 ステップ分しか進まない (連続性)", () => {
    // 1.8 + 1.0*0.5 = 2.3, mod 2.0 = 0.3
    expect(stepDisplacement(1.8, 1.0, 0.5, 2.0)).toBeCloseTo(0.3, 5);
  });

  test("速度が大きく変動しても進む量は speed*dt のみ (瞬間移動しない)", () => {
    let d = 0;
    d = stepDisplacement(d, 100.0, 0.016, 2.0); // 速い列
    const after = stepDisplacement(d, 0.1, 0.016, 2.0); // 急に遅くなっても
    // 2 ステップ目の前進量は 0.1*0.016 = 0.0016 だけ
    const advance = ((after - d) % 2.0 + 2.0) % 2.0;
    expect(advance).toBeCloseTo(0.0016, 5);
  });

  test("areaHeight<=0 は 0 を返す", () => {
    expect(stepDisplacement(1.0, 1.0, 0.1, 0)).toBe(0);
  });
});
