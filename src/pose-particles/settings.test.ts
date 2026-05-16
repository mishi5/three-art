import { describe, expect, test } from "bun:test";
import {
  RENDER_MODES,
  modeToInt,
  makeDefaultSettings,
  MOTION_TARGETS,
} from "./settings";

describe("RenderMode", () => {
  test("RENDER_MODES に lattice / image が含まれ全 5 値", () => {
    expect(RENDER_MODES.length).toBe(5);
    expect(RENDER_MODES).toContain("lattice");
    expect(RENDER_MODES).toContain("image");
  });

  test("modeToInt は lattice=3 / image=4 を返す", () => {
    expect(modeToInt("lattice")).toBe(3);
    expect(modeToInt("image")).toBe(4);
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

describe("ImageSettings defaults", () => {
  test("makeDefaultSettings に image が含まれ妥当な範囲", () => {
    const s = makeDefaultSettings();
    expect(typeof s.image.preset).toBe("string");
    expect(s.image.gridW).toBeGreaterThanOrEqual(8);
    expect(s.image.gridH).toBeGreaterThanOrEqual(8);
    // gridW * gridH は粒子総数 (NUM_JOINTS * POINTS_PER_JOINT = 5200) を超えない
    expect(s.image.gridW * s.image.gridH).toBeLessThanOrEqual(5200);
    expect(s.image.pushAmount).toBeGreaterThan(0);
    expect(s.image.noiseAmp).toBeGreaterThanOrEqual(0);
    expect(s.image.noiseScale).toBeGreaterThan(0);
    expect(s.image.noiseSpeed).toBeGreaterThanOrEqual(0);
    expect(s.image.waveStrength).toBeGreaterThan(0);
    expect(s.image.sizeScale).toBeGreaterThan(0);
    expect(["circle", "square"]).toContain(s.image.particleShape);
  });
});

describe("MOTION_TARGETS", () => {
  test("lattice.waveAmplitude と lattice.waveOscFreq を含む", () => {
    expect(MOTION_TARGETS).toContain("lattice.waveAmplitude");
    expect(MOTION_TARGETS).toContain("lattice.waveOscFreq");
  });

  test("image.pushAmount / image.noiseAmp / image.waveStrength を含む", () => {
    expect(MOTION_TARGETS).toContain("image.pushAmount");
    expect(MOTION_TARGETS).toContain("image.noiseAmp");
    expect(MOTION_TARGETS).toContain("image.waveStrength");
  });
});
