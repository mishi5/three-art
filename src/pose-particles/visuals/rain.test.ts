import { describe, expect, test } from "bun:test";
import {
  advanceParticleY,
  expectedRainSpeed,
  mapBinIndex,
  pickSpawnSpeed,
} from "./rain";

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

  test("log: 画面中央が低域に強く偏る", () => {
    const mid = mapBinIndex(50, 101, 1024, "log");
    expect(mid).toBe(31);
    expect(mid).toBeLessThan(mapBinIndex(50, 101, 1024, "linear"));
  });

  test("fftLen<=1 / n<=1 は 0", () => {
    expect(mapBinIndex(5, 100, 1, "log")).toBe(0);
    expect(mapBinIndex(0, 1, 1024, "linear")).toBe(0);
  });
});

describe("pickSpawnSpeed", () => {
  test("jitter=0.5 は素の baseSpeed+ampGain*amp", () => {
    expect(pickSpawnSpeed(0.1, 1.0, 0.4, 0.5)).toBeCloseTo(0.5, 5);
  });

  test("jitter=0 は -15% 係数", () => {
    expect(pickSpawnSpeed(0.1, 1.0, 0.4, 0)).toBeCloseTo(0.5 * 0.85, 5);
  });

  test("jitter=1 は +15% 係数", () => {
    expect(pickSpawnSpeed(0.1, 1.0, 0.4, 1)).toBeCloseTo(0.5 * 1.15, 5);
  });
});

describe("advanceParticleY", () => {
  const H = 2.4; // half = 1.2

  test("下端を越えなければ単純に下降 (respawn しない)", () => {
    const r = advanceParticleY(0, 0.6, 1.0, H);
    expect(r.y).toBeCloseTo(-0.6, 5);
    expect(r.respawned).toBe(false);
  });

  test("下端を越えたら上側へラップし respawned=true", () => {
    const r = advanceParticleY(-1.0, 1.0, 0.5, H);
    // pos=0.2, new=-0.3, wrap=2.1, y=0.9
    expect(r.y).toBeCloseTo(0.9, 5);
    expect(r.respawned).toBe(true);
  });

  test("1 ステップが領域より大きくても modulo で正しくラップ", () => {
    const r = advanceParticleY(0, 10, 1.0, H);
    expect(r.y).toBeCloseTo(-0.4, 5);
    expect(r.respawned).toBe(true);
  });

  test("areaHeight<=0 は y=0", () => {
    const r = advanceParticleY(1.0, 1.0, 0.1, 0);
    expect(r.y).toBe(0);
    expect(r.respawned).toBe(false);
  });
});
