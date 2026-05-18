import { describe, expect, test } from "bun:test";
import { makeDefaultSettings } from "../settings";
import { settingsLeafPaths } from "./param-docs";
import { paramActiveForMode, relevancePaths } from "./param-relevance";

describe("param-relevance: 完全性", () => {
  test("makeDefaultSettings の全 leaf パスが relevance マップに登録済み", () => {
    const leaves = settingsLeafPaths(makeDefaultSettings());
    const registered = new Set(relevancePaths());
    const missing = leaves.filter((p) => !registered.has(p));
    expect(missing).toEqual([]);
  });

  test("relevance マップに余分な (settings に無い) パスが無い", () => {
    const leaves = new Set(settingsLeafPaths(makeDefaultSettings()));
    const extra = relevancePaths().filter((p) => !leaves.has(p));
    expect(extra).toEqual([]);
  });
});

describe("param-relevance: 代表挙動", () => {
  test("全 mode 共通: audioSmoothing / camera / motion / blur / auto / mode", () => {
    for (const m of ["bones", "cube", "sphere", "lattice", "image", "rain"] as const) {
      expect(paramActiveForMode("audioSmoothing", m)).toBe(true);
      expect(paramActiveForMode("camera.autoRotateSpeed", m)).toBe(true);
      expect(paramActiveForMode("motion.strength", m)).toBe(true);
      expect(paramActiveForMode("blur.strength", m)).toBe(true);
      expect(paramActiveForMode("auto.transitionSec", m)).toBe(true);
      expect(paramActiveForMode("mode", m)).toBe(true);
    }
  });

  test("rain: color / pointCloud / twist / audioGain は非活性", () => {
    expect(paramActiveForMode("color.saturation", "rain")).toBe(false);
    expect(paramActiveForMode("color.trebleBoost", "rain")).toBe(false);
    expect(paramActiveForMode("pointCloud.baseSize", "rain")).toBe(false);
    expect(paramActiveForMode("twist.strength", "rain")).toBe(false);
    expect(paramActiveForMode("audioGain.volume", "rain")).toBe(false);
    // rain 専用と共通は活性
    expect(paramActiveForMode("rain.baseSpeed", "rain")).toBe(true);
    expect(paramActiveForMode("blur.strength", "rain")).toBe(true);
  });

  test("pointCloud.bassExpansion は bones 専用", () => {
    expect(paramActiveForMode("pointCloud.bassExpansion", "bones")).toBe(true);
    for (const m of ["cube", "sphere", "lattice", "image", "rain"] as const) {
      expect(paramActiveForMode("pointCloud.bassExpansion", m)).toBe(false);
    }
  });

  test("fragmentField.* は bones 専用", () => {
    expect(paramActiveForMode("fragmentField.driftBase", "bones")).toBe(true);
    expect(paramActiveForMode("fragmentField.driftBase", "cube")).toBe(false);
  });

  test("image の色: hue 系は非活性、trebleBoost のみ活性", () => {
    expect(paramActiveForMode("color.hueBase", "image")).toBe(false);
    expect(paramActiveForMode("color.saturation", "image")).toBe(false);
    expect(paramActiveForMode("color.bassHueShift", "image")).toBe(false);
    expect(paramActiveForMode("color.trebleBoost", "image")).toBe(true);
  });

  test("edges.* は bones/cube/sphere のみ", () => {
    for (const m of ["bones", "cube", "sphere"] as const) {
      expect(paramActiveForMode("edges.alpha", m)).toBe(true);
    }
    for (const m of ["lattice", "image", "rain"] as const) {
      expect(paramActiveForMode("edges.alpha", m)).toBe(false);
    }
  });

  test("wave 系は lattice と image で共有、resolution/onset は lattice のみ", () => {
    expect(paramActiveForMode("lattice.waveSpeed", "lattice")).toBe(true);
    expect(paramActiveForMode("lattice.waveSpeed", "image")).toBe(true);
    expect(paramActiveForMode("lattice.waveAmplitude", "image")).toBe(true);
    expect(paramActiveForMode("lattice.resolution", "image")).toBe(false);
    expect(paramActiveForMode("lattice.resolution", "lattice")).toBe(true);
    expect(paramActiveForMode("lattice.onsetThreshold", "image")).toBe(false);
  });

  test("image.* は image 専用、rain.* は rain 専用", () => {
    expect(paramActiveForMode("image.pushAmount", "image")).toBe(true);
    expect(paramActiveForMode("image.pushAmount", "lattice")).toBe(false);
    expect(paramActiveForMode("rain.count", "rain")).toBe(true);
    expect(paramActiveForMode("rain.count", "bones")).toBe(false);
  });

  test("未登録パスは fail-open (true)", () => {
    expect(paramActiveForMode("nonexistent.path", "bones")).toBe(true);
  });
});
