import { expect, test, describe } from "bun:test";
import {
  ScreenToneNode,
  SCREEN_TONE_MODES,
  SCREEN_TONE_COLORS,
  screenToneModeToFloat,
  screenToneColorToFloat,
  sanitizeScreenToneParams,
  screenToneBandWeights,
  TONE_BANDS,
  TONE_BAND_FADE,
} from "./ScreenToneNode";
import { createDefaultRegistry } from "./registry";
import type { EvalContext } from "../graph/node-type";

const noCtx: EvalContext = {
  timeSec: 0, input: () => undefined, param: () => undefined,
  node: { id: "x", type: "ScreenTone", params: {} },
};

describe("ScreenToneNode (#290)", () => {
  test("texture→texture の effect ノード", () => {
    expect(ScreenToneNode.inputs.map((p) => p.type)).toEqual(["texture"]);
    expect(ScreenToneNode.outputs.map((p) => p.type)).toEqual(["texture"]);
    expect(ScreenToneNode.category).toBe("effect");
    expect(ScreenToneNode.isSink).toBe(true);
    expect(ScreenToneNode.evaluate(noCtx)).toEqual({}); // state/env なしは no-op
  });

  test("params: enabled + mode/scale/angle/gamma/color/mix", () => {
    expect(ScreenToneNode.params.map((p) => p.id)).toEqual([
      "enabled", "mode", "scale", "angle", "gamma", "color", "mix",
    ]);
    expect(ScreenToneNode.params.find((p) => p.id === "enabled")?.default).toBe("on");
  });

  test("mode/color は enum（定義順が uniform 値）・既定 auto/mono", () => {
    const mode = ScreenToneNode.params.find((p) => p.id === "mode");
    expect(mode?.kind).toBe("enum");
    expect(mode?.options).toEqual(["auto", "dot", "line", "cross"]);
    expect(mode?.default).toBe("auto");
    const color = ScreenToneNode.params.find((p) => p.id === "color");
    expect(color?.kind).toBe("enum");
    expect(color?.options).toEqual(["mono", "color"]);
    expect(color?.default).toBe("mono");
  });

  test("数値 param の既定と範囲", () => {
    const byId = new Map(ScreenToneNode.params.map((p) => [p.id, p]));
    expect(byId.get("scale")).toMatchObject({ default: 120, min: 20, max: 400 });
    expect(byId.get("angle")).toMatchObject({ default: 45, min: 0, max: 180 });
    expect(byId.get("gamma")).toMatchObject({ default: 1, min: 0.2, max: 3 });
    expect(byId.get("mix")).toMatchObject({ default: 1, min: 0, max: 1 });
  });

  test("registry に登録されている", () => {
    expect(createDefaultRegistry().get("ScreenTone")).toBeDefined();
  });

  test("enabled=off は入力をそのままパススルー（#134）", () => {
    const st = ScreenToneNode.createState!({} as never);
    const tex = { isTexture: true };
    const out = ScreenToneNode.evaluate({
      ...noCtx,
      state: st,
      input: (id) => (id === "in" ? tex : undefined),
      param: (id) => (id === "enabled" ? "off" : undefined),
    });
    expect(out.texture).toBe(tex);
    ScreenToneNode.disposeState!(st, {} as never);
  });
});

describe("screenToneModeToFloat / screenToneColorToFloat", () => {
  test("定義順のインデックスを返す", () => {
    expect(SCREEN_TONE_MODES).toEqual(["auto", "dot", "line", "cross"]);
    expect(screenToneModeToFloat("auto")).toBe(0);
    expect(screenToneModeToFloat("dot")).toBe(1);
    expect(screenToneModeToFloat("line")).toBe(2);
    expect(screenToneModeToFloat("cross")).toBe(3);
    expect(SCREEN_TONE_COLORS).toEqual(["mono", "color"]);
    expect(screenToneColorToFloat("mono")).toBe(0);
    expect(screenToneColorToFloat("color")).toBe(1);
  });

  test("不正値は 0 にフォールバック（auto / mono）", () => {
    expect(screenToneModeToFloat("unknown")).toBe(0);
    expect(screenToneModeToFloat(undefined)).toBe(0);
    expect(screenToneModeToFloat(3)).toBe(0);
    expect(screenToneColorToFloat("rainbow")).toBe(0);
    expect(screenToneColorToFloat(undefined)).toBe(0);
  });
});

describe("sanitizeScreenToneParams", () => {
  test("範囲内はそのまま", () => {
    expect(sanitizeScreenToneParams({ scale: 200, angle: 30, gamma: 2, mix: 0.5 }))
      .toEqual({ scale: 200, angle: 30, gamma: 2, mix: 0.5 });
  });

  test("未指定・NaN は既定値", () => {
    expect(sanitizeScreenToneParams({}))
      .toEqual({ scale: 120, angle: 45, gamma: 1, mix: 1 });
    expect(sanitizeScreenToneParams({ scale: NaN, angle: NaN, gamma: NaN, mix: NaN }))
      .toEqual({ scale: 120, angle: 45, gamma: 1, mix: 1 });
  });

  test("範囲外はクランプ", () => {
    expect(sanitizeScreenToneParams({ scale: 1, angle: -10, gamma: 0, mix: 2 }))
      .toEqual({ scale: 20, angle: 0, gamma: 0.2, mix: 1 });
    expect(sanitizeScreenToneParams({ scale: 9999, angle: 720, gamma: 99, mix: -1 }))
      .toEqual({ scale: 400, angle: 180, gamma: 3, mix: 0 });
  });
});

describe("screenToneBandWeights（auto の帯域選択）", () => {
  test("しきい値定数は昇順・フェード幅は帯域幅より十分小さい", () => {
    const b = [TONE_BANDS.solid, TONE_BANDS.cross, TONE_BANDS.line, TONE_BANDS.dot];
    for (let i = 1; i < b.length; i++) {
      expect(b[i]!).toBeGreaterThan(b[i - 1]!);
      // フェード区間（±FADE）が隣のしきい値と重ならない
      expect(b[i]! - b[i - 1]!).toBeGreaterThan(2 * TONE_BAND_FADE);
    }
  });

  test("重みの総和は常に 1", () => {
    for (let L = 0; L <= 1.0001; L += 0.01) {
      const w = screenToneBandWeights(L);
      const sum = w.solid + w.cross + w.line + w.dot + w.white;
      expect(sum).toBeCloseTo(1, 10);
    }
  });

  test("帯域中心では該当トーンが支配的（重み 1）", () => {
    expect(screenToneBandWeights(0.05).solid).toBeCloseTo(1, 10); // < 0.12 はベタ
    expect(screenToneBandWeights(0.25).cross).toBeCloseTo(1, 10); // 0.12-0.35
    expect(screenToneBandWeights(0.5).line).toBeCloseTo(1, 10);   // 0.35-0.60
    expect(screenToneBandWeights(0.75).dot).toBeCloseTo(1, 10);   // 0.60-0.88
    expect(screenToneBandWeights(0.95).white).toBeCloseTo(1, 10); // > 0.88 は白
  });

  test("しきい値ちょうどでは両側が 50/50 にクロスフェード", () => {
    const w = screenToneBandWeights(TONE_BANDS.line);
    expect(w.line).toBeCloseTo(0.5, 10);
    expect(w.dot).toBeCloseTo(0.5, 10);
  });
});
