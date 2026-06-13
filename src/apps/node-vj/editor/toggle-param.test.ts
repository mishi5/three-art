import { expect, test, describe } from "bun:test";
import { isToggleParam, toggleOnValue, toggledValue } from "./toggle-param";
import type { ParamDef } from "../graph/node-type";

const offOn: ParamDef = { id: "x", label: "", kind: "enum", default: "off", options: ["off", "on"] };
const onOff: ParamDef = { id: "x", label: "", kind: "enum", default: "on", options: ["on", "off"] };
const tri: ParamDef = { id: "m", label: "", kind: "enum", default: "a", options: ["a", "b", "c"] };
const num: ParamDef = { id: "n", label: "", kind: "number", default: 0 };

describe("toggle-param", () => {
  test("isToggleParam は 2 値 enum のみ true", () => {
    expect(isToggleParam(offOn)).toBe(true);
    expect(isToggleParam(onOff)).toBe(true);
    expect(isToggleParam(tri)).toBe(false);   // 3 値
    expect(isToggleParam(num)).toBe(false);   // 数値
  });

  test("toggleOnValue は on/true を優先、無ければ 2 つ目", () => {
    expect(toggleOnValue(offOn)).toBe("on");
    expect(toggleOnValue(onOff)).toBe("on");
    expect(toggleOnValue({ ...offOn, options: ["lo", "hi"] })).toBe("hi");
  });

  test("toggledValue は反転", () => {
    expect(toggledValue(offOn, "off")).toBe("on");
    expect(toggledValue(offOn, "on")).toBe("off");
    expect(toggledValue(onOff, "on")).toBe("off");
  });
});
