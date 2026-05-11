import { describe, expect, test } from "bun:test";
import {
  RENDER_MODES,
  modeToInt,
  makeDefaultSettings,
  MOTION_TARGETS,
} from "./settings";

describe("RenderMode", () => {
  test("RENDER_MODES に lattice が含まれ全 4 値", () => {
    expect(RENDER_MODES.length).toBe(4);
    expect(RENDER_MODES).toContain("lattice");
  });

  test("modeToInt は lattice=3 を返す", () => {
    expect(modeToInt("lattice")).toBe(3);
    expect(modeToInt("bones")).toBe(0);
    expect(modeToInt("cube")).toBe(1);
    expect(modeToInt("sphere")).toBe(2);
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
