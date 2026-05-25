import { describe, expect, test } from "bun:test";
import {
  RENDER_MODES,
  modeToInt,
  makeDefaultSettings,
  MOTION_TARGETS,
  POLYHEDRON_FACES,
} from "./settings";

describe("RenderMode", () => {
  test("RENDER_MODES に lattice / image / rain が含まれ全 6 値", () => {
    expect(RENDER_MODES.length).toBe(6);
    expect(RENDER_MODES).toContain("lattice");
    expect(RENDER_MODES).toContain("image");
    expect(RENDER_MODES).toContain("rain");
  });

  test("modeToInt は lattice=3 / image=4 / rain=5 を返す", () => {
    expect(modeToInt("lattice")).toBe(3);
    expect(modeToInt("image")).toBe(4);
    expect(modeToInt("rain")).toBe(5);
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

describe("LatticeSettings distortion defaults (Issue #41)", () => {
  test("baseShape はデフォルト 'cube' (現状互換)", () => {
    const s = makeDefaultSettings();
    expect(s.lattice.baseShape).toBe("cube");
  });

  test("歪み系パラメータは全て『歪みなし』のデフォルト値", () => {
    const s = makeDefaultSettings();
    expect(s.lattice.noiseAmount).toBe(0);
    expect(s.lattice.twist).toBe(0);
    expect(s.lattice.bend).toBe(0);
    expect(s.lattice.taper).toBe(1);
    expect(s.lattice.rippleAmp).toBe(0);
  });

  test("歪み系の周波数/seed はデフォルトでも妥当な正数", () => {
    const s = makeDefaultSettings();
    expect(s.lattice.noiseScale).toBeGreaterThan(0);
    expect(Number.isInteger(s.lattice.noiseSeed)).toBe(true);
    expect(s.lattice.noiseSeed).toBeGreaterThan(0);
    expect(s.lattice.rippleFreq).toBeGreaterThan(0);
  });

  test("MOTION_TARGETS に歪み系の Amount/twist/bend/ripple が含まれる", () => {
    expect(MOTION_TARGETS).toContain("lattice.noiseAmount");
    expect(MOTION_TARGETS).toContain("lattice.twist");
    expect(MOTION_TARGETS).toContain("lattice.bend");
    expect(MOTION_TARGETS).toContain("lattice.rippleAmp");
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

describe("EdgesSettings new fields (Issue #31)", () => {
  test("legacy edges fields unchanged", () => {
    const s = makeDefaultSettings();
    expect(s.edges.enabled).toBe(false);
    expect(s.edges.anchorCount).toBe(64);
    expect(s.edges.kNeighbors).toBe(2);
    expect(s.edges.alpha).toBe(0.5);
  });

  test("edges.wave defaults are present and within documented ranges", () => {
    const s = makeDefaultSettings();
    expect(s.edges.wave.enabled).toBe(false);
    expect(s.edges.wave.subdivisions).toBe(8);
    expect(s.edges.wave.amplitude).toBeCloseTo(0.05);
    expect(s.edges.wave.audioBoost).toBeCloseTo(1.0);
    expect(s.edges.wave.scale).toBeCloseTo(2.0);
    expect(s.edges.wave.speed).toBeCloseTo(0.6);
  });

  test("edges.rewire defaults are present and within documented ranges", () => {
    const s = makeDefaultSettings();
    expect(s.edges.rewire.enabled).toBe(false);
    expect(s.edges.rewire.interval).toBeCloseTo(1.5);
    expect(s.edges.rewire.fraction).toBeCloseTo(0.3);
    expect(s.edges.rewire.fadeDuration).toBeCloseTo(0.4);
    expect(s.edges.rewire.candidatePool).toBeGreaterThanOrEqual(s.edges.kNeighbors);
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

describe("ShapeSettings polyhedron (Issue #40)", () => {
  test("makeDefaultSettings().shape.polyhedron === 6 (現状 cube の見た目互換)", () => {
    const s = makeDefaultSettings();
    expect(s.shape.polyhedron).toBe(6);
  });

  test("POLYHEDRON_FACES は 4/6/8/12 の 4 値", () => {
    expect(POLYHEDRON_FACES).toEqual([4, 6, 8, 12]);
  });
});
