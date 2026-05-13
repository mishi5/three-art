import { describe, expect, test } from "bun:test";
import {
  RENDER_MODES,
  modeToInt,
  makeDefaultSettings,
  MOTION_TARGETS,
} from "./settings";

describe("RenderMode", () => {
  test("RENDER_MODES に rain が含まれ全 5 値", () => {
    expect(RENDER_MODES.length).toBe(5);
    expect(RENDER_MODES).toContain("lattice");
    expect(RENDER_MODES).toContain("rain");
  });

  test("modeToInt は rain=4 を返す", () => {
    expect(modeToInt("rain")).toBe(4);
    expect(modeToInt("lattice")).toBe(3);
    expect(modeToInt("bones")).toBe(0);
    expect(modeToInt("cube")).toBe(1);
    expect(modeToInt("sphere")).toBe(2);
  });
});

describe("RainSettings defaults", () => {
  test("makeDefaultSettings に rain が含まれ妥当な範囲", () => {
    const s = makeDefaultSettings();
    expect(s.rain.baseSpeed).toBeGreaterThan(0);
    expect(s.rain.ampGain).toBeGreaterThan(0);
    expect(s.rain.count).toBeGreaterThanOrEqual(256);
    expect(s.rain.length).toBeGreaterThan(0);
    expect(s.rain.areaWidth).toBeGreaterThan(0);
    expect(s.rain.areaHeight).toBeGreaterThan(0);
    expect(["linear", "log"]).toContain(s.rain.binMapping);
  });
});

describe("LatticeSettings defaults", () => {
  test("makeDefaultSettings に lattice が含まれ妥当な範囲", () => {
    const s = makeDefaultSettings();
    expect(s.lattice.resolution).toBe(12);
    expect(s.lattice.waveSpeed).toBeGreaterThan(0);
    expect(s.lattice.waveAmplitude).toBeGreaterThan(0);
    expect(s.lattice.waveOscFreq).toBeGreaterThan(0);
    expect(s.lattice.waveDamping).toBeGreaterThan(0);
    expect(s.lattice.onsetThreshold).toBeGreaterThan(0);
    expect(s.lattice.onsetCooldown).toBeGreaterThan(0);
  });
});

describe("MOTION_TARGETS", () => {
  test("lattice.waveAmplitude と lattice.waveOscFreq を含む", () => {
    expect(MOTION_TARGETS).toContain("lattice.waveAmplitude");
    expect(MOTION_TARGETS).toContain("lattice.waveOscFreq");
  });
});
