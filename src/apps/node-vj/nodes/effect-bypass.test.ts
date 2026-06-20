import { expect, test, describe } from "bun:test";
import { EFFECT_ENABLED_PARAM, isEffectEnabled, bypassOutput } from "./effect-bypass";

describe("EFFECT_ENABLED_PARAM", () => {
  test("enum on/off・既定 on", () => {
    expect(EFFECT_ENABLED_PARAM.id).toBe("enabled");
    expect(EFFECT_ENABLED_PARAM.kind).toBe("enum");
    expect(EFFECT_ENABLED_PARAM.options).toEqual(["on", "off"]);
    expect(EFFECT_ENABLED_PARAM.default).toBe("on");
  });
});

describe("isEffectEnabled", () => {
  test("on/未設定は有効", () => {
    expect(isEffectEnabled(() => "on")).toBe(true);
    expect(isEffectEnabled(() => undefined)).toBe(true);
  });
  test("off は無効", () => {
    expect(isEffectEnabled(() => "off")).toBe(false);
  });
});

describe("bypassOutput", () => {
  test("入力 in があればそれを texture に流す", () => {
    const tex = { id: "tex" };
    const out = bypassOutput((id) => (id === "in" ? tex : undefined), { black: true });
    expect(out.texture).toBe(tex);
  });
  test("入力未接続なら black", () => {
    const black = { black: true };
    const out = bypassOutput(() => undefined, black);
    expect(out.texture).toBe(black);
  });
});
