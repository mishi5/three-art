import { describe, expect, test } from "bun:test";
import {
  AutomationEntry,
  DEFAULT_AUTOMATION_MAP,
  computeValue,
  type SectionFeatures,
} from "./AutomationMap";

const ZERO: SectionFeatures = { energyNorm: 0, bassAbs: 0, midAbs: 0, trebleAbs: 0 };

describe("computeValue", () => {
  test("全特徴 0 のとき base が返る", () => {
    const e: AutomationEntry = { target: "x", base: 1.5, we: 9, wb: 9, wm: 9, wt: 9, min: 0, max: 10 };
    expect(computeValue(e, ZERO)).toBe(1.5);
  });

  test("線形重みが正しく合計される", () => {
    const e: AutomationEntry = { target: "x", base: 0, we: 1, wb: 2, wm: 3, wt: 4, min: -100, max: 100 };
    expect(computeValue(e, { energyNorm: 0.5, bassAbs: 0.5, midAbs: 0.5, trebleAbs: 0.5 }))
      .toBeCloseTo(0.5 + 1 + 1.5 + 2);
  });

  test("min で下限がかかる", () => {
    const e: AutomationEntry = { target: "x", base: 0, we: -10, wb: 0, wm: 0, wt: 0, min: 0, max: 1 };
    expect(computeValue(e, { ...ZERO, energyNorm: 1 })).toBe(0);
  });

  test("max で上限がかかる", () => {
    const e: AutomationEntry = { target: "x", base: 0, we: 10, wb: 0, wm: 0, wt: 0, min: 0, max: 1 };
    expect(computeValue(e, { ...ZERO, energyNorm: 1 })).toBe(1);
  });
});

describe("DEFAULT_AUTOMATION_MAP", () => {
  test("10 entries", () => {
    expect(DEFAULT_AUTOMATION_MAP).toHaveLength(10);
  });

  test("全特徴 0 のとき各 entry の値は base と一致する", () => {
    for (const e of DEFAULT_AUTOMATION_MAP) {
      expect(computeValue(e, ZERO)).toBe(e.base);
    }
  });

  test("対象 target は重複しない", () => {
    const set = new Set(DEFAULT_AUTOMATION_MAP.map((e) => e.target));
    expect(set.size).toBe(DEFAULT_AUTOMATION_MAP.length);
  });

  test("期待される target を含む (spec 表に対応)", () => {
    const targets = DEFAULT_AUTOMATION_MAP.map((e) => e.target);
    for (const t of [
      "color.hueBase", "color.saturation", "color.bassHueShift",
      "pointCloud.bassExpansion", "pointCloud.trebleShimmer", "pointCloud.volumeSize",
      "fragmentField.midDrift", "fragmentField.jointPull",
      "blur.strength", "camera.autoRotateSpeed",
    ]) {
      expect(targets).toContain(t);
    }
  });
});
