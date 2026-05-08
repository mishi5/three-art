import { describe, expect, test } from "bun:test";
import type { Section, SectionBoundary } from "./AnalysisCache";
import { type AutomationMap, type StylePreset } from "./AutomationMap";
import { ParameterAutomation } from "./ParameterAutomation";

interface FakeLive {
  color: { hueBase: number };
  blur: { strength: number };
}
function makeLive(): FakeLive {
  return { color: { hueBase: 0.5 }, blur: { strength: 0.0 } };
}

const MAP: AutomationMap = [
  { target: "color.hueBase",  base: 0,   we: 1, wb: 0, wm: 0, wt: 0, min: 0, max: 1 },
  { target: "blur.strength",  base: 0,   we: 0, wb: 1, wm: 0, wt: 0, min: 0, max: 2 },
];

const SECTIONS: Section[] = [
  { start: 0,  end: 10, energyNorm: 0.0, bassAbs: 0.0, midAbs: 0, trebleAbs: 0 },
  { start: 10, end: 20, energyNorm: 1.0, bassAbs: 1.0, midAbs: 0, trebleAbs: 0 },
];
const BOUNDARIES: SectionBoundary[] = [{ t: 10, source: "auto" }];

describe("ParameterAutomation.applyAt", () => {
  test("セクション中央点では純粋に式どおりの値が出る (補間なし)", () => {
    const auto = new ParameterAutomation(SECTIONS, BOUNDARIES, MAP, 1.0);
    const live1 = makeLive();
    auto.applyAt(2, live1 as unknown as Record<string, unknown>);
    expect(live1.color.hueBase).toBe(0);
    expect(live1.blur.strength).toBe(0);

    const live2 = makeLive();
    auto.applyAt(15, live2 as unknown as Record<string, unknown>);
    expect(live2.color.hueBase).toBe(1);
    expect(live2.blur.strength).toBe(1);
  });

  test("境界の真上 (t = 10, transitionSec=2) では中点になる", () => {
    const auto = new ParameterAutomation(SECTIONS, BOUNDARIES, MAP, 2.0);
    const live = makeLive();
    auto.applyAt(10, live as unknown as Record<string, unknown>);
    expect(live.color.hueBase).toBeCloseTo(0.5, 2);
    expect(live.blur.strength).toBeCloseTo(0.5, 2);
  });

  test("補間は smoothstep (cubic) であって linear ではない", () => {
    // t=9.5, transitionSec=2 → u=0.25 → smoothstep(0.25)=0.15625
    // 線形 lerp なら 0.25 になるが、smoothstep の cubic 形状で 0.15625 になる
    const auto = new ParameterAutomation(SECTIONS, BOUNDARIES, MAP, 2.0);
    const live = makeLive();
    auto.applyAt(9.5, live as unknown as Record<string, unknown>);
    expect(live.color.hueBase).toBeCloseTo(0.15625, 4);
    expect(live.blur.strength).toBeCloseTo(0.15625, 4);
  });

  test("境界より transitionSec/2 以上離れていれば補間がかからない", () => {
    const auto = new ParameterAutomation(SECTIONS, BOUNDARIES, MAP, 2.0);
    const live = makeLive();
    auto.applyAt(8.5, live as unknown as Record<string, unknown>);
    expect(live.color.hueBase).toBe(0);
  });

  test("単一セクションだけのときも動く (補間なし)", () => {
    const single: Section[] = [
      { start: 0, end: 10, energyNorm: 0.5, bassAbs: 0.7, midAbs: 0, trebleAbs: 0 },
    ];
    const auto = new ParameterAutomation(single, [], MAP, 1.0);
    const live = makeLive();
    auto.applyAt(5, live as unknown as Record<string, unknown>);
    expect(live.color.hueBase).toBeCloseTo(0.5, 2);
    expect(live.blur.strength).toBeCloseTo(0.7, 2);
  });

  test("曲頭 / 曲末では片側のセクションが無いので補間しない", () => {
    const auto = new ParameterAutomation(SECTIONS, BOUNDARIES, MAP, 4.0);
    const headLive = makeLive();
    auto.applyAt(0.1, headLive as unknown as Record<string, unknown>);
    expect(headLive.color.hueBase).toBe(0);

    const tailLive = makeLive();
    auto.applyAt(19.9, tailLive as unknown as Record<string, unknown>);
    expect(tailLive.color.hueBase).toBe(1);
  });

  test("clamp が両端で機能する", () => {
    const map: AutomationMap = [
      { target: "color.hueBase", base: 0, we: 10, wb: 0, wm: 0, wt: 0, min: 0, max: 0.7 },
    ];
    const auto = new ParameterAutomation(SECTIONS, BOUNDARIES, map, 1.0);
    const live = makeLive();
    auto.applyAt(15, live as unknown as Record<string, unknown>);
    expect(live.color.hueBase).toBe(0.7);
  });

  test("styleStrength=0 では style 配列が無視される (従来挙動)", () => {
    const styles: StylePreset[] = [{
      features: { energyNorm: 1, bassAbs: 1, midAbs: 1, trebleAbs: 1 },
      overrides: { "color.hueBase": 0.99 },
    }];
    const auto = new ParameterAutomation(SECTIONS, BOUNDARIES, MAP, 0, styles, 0);
    const live = makeLive();
    auto.applyAt(2, live as unknown as Record<string, unknown>);
    // section 0: energyNorm=0, bassAbs=0 → MAP の we=1, wb=1 で計算しても両方 0
    // overrides も適用されない
    expect(live.color.hueBase).toBe(0);
    expect(live.blur.strength).toBe(0);
  });

  test("styleStrength=1 で features が完全支配する", () => {
    const styles: StylePreset[] = [{
      features: { energyNorm: 1, bassAbs: 0, midAbs: 0, trebleAbs: 0 },
      overrides: {},
    }];
    const auto = new ParameterAutomation(SECTIONS, BOUNDARIES, MAP, 0, styles, 1);
    const live = makeLive();
    auto.applyAt(2, live as unknown as Record<string, unknown>);
    // section 0 の実 features (all 0) を捨てて style[0].features の energyNorm=1 を使用
    // MAP[0]: target=color.hueBase, we=1 → 1 * 1 = 1
    expect(live.color.hueBase).toBe(1);
  });

  test("styles はセクション順で循環する (idx % styles.length)", () => {
    const styles: StylePreset[] = [
      { features: { energyNorm: 0, bassAbs: 0, midAbs: 0, trebleAbs: 0 }, overrides: {} },
      { features: { energyNorm: 1, bassAbs: 0, midAbs: 0, trebleAbs: 0 }, overrides: {} },
    ];
    const auto = new ParameterAutomation(SECTIONS, BOUNDARIES, MAP, 0, styles, 1);
    const live0 = makeLive();
    auto.applyAt(2, live0 as unknown as Record<string, unknown>);
    expect(live0.color.hueBase).toBe(0);
    const live1 = makeLive();
    auto.applyAt(15, live1 as unknown as Record<string, unknown>);
    expect(live1.color.hueBase).toBe(1);
  });

  test("style.overrides が discrete 値を上書きする (補間なし、瞬時切替)", () => {
    interface FakeLiveExt {
      color: { hueBase: number };
      blur: { strength: number; enabled: boolean };
      mode: string;
    }
    const styles: StylePreset[] = [
      {
        features: { energyNorm: 0, bassAbs: 0, midAbs: 0, trebleAbs: 0 },
        overrides: { mode: "cube", "blur.enabled": true },
      },
      {
        features: { energyNorm: 0, bassAbs: 0, midAbs: 0, trebleAbs: 0 },
        overrides: { mode: "sphere", "blur.enabled": false },
      },
    ];
    const auto = new ParameterAutomation(SECTIONS, BOUNDARIES, MAP, 0, styles, 0.5);

    const live0: FakeLiveExt = { color: { hueBase: 0.5 }, blur: { strength: 0, enabled: false }, mode: "bones" };
    auto.applyAt(2, live0 as unknown as Record<string, unknown>);
    expect(live0.mode).toBe("cube");
    expect(live0.blur.enabled).toBe(true);

    const live1: FakeLiveExt = { color: { hueBase: 0.5 }, blur: { strength: 0, enabled: true }, mode: "bones" };
    auto.applyAt(15, live1 as unknown as Record<string, unknown>);
    expect(live1.mode).toBe("sphere");
    expect(live1.blur.enabled).toBe(false);
  });

  test("styleStrength=0 のとき overrides も適用されない", () => {
    const styles: StylePreset[] = [{
      features: { energyNorm: 0, bassAbs: 0, midAbs: 0, trebleAbs: 0 },
      overrides: { "color.hueBase": 0.42 },
    }];
    const auto = new ParameterAutomation(SECTIONS, BOUNDARIES, MAP, 0, styles, 0);
    const live = makeLive();
    auto.applyAt(2, live as unknown as Record<string, unknown>);
    // styleStrength=0 で overrides もスキップされる (実 features での計算のみ)
    expect(live.color.hueBase).toBe(0); // section 0 の実 features (all 0) で計算
  });
});
