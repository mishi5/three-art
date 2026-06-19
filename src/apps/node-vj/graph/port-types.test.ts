import { expect, test, describe } from "bun:test";
import { PORT_TYPES, isCompatible, type PortType } from "./port-types";

describe("port-types", () => {
  test("PORT_TYPES に ADR #59 の全型が含まれる", () => {
    const expected: PortType[] = [
      "number", "vec2", "vec3", "color", "pose", "audio", "texture", "trigger", "points", "audioSignal",
    ];
    for (const t of expected) expect(PORT_TYPES).toContain(t);
    expect(PORT_TYPES.length).toBe(expected.length);
  });

  test("同一型は接続互換", () => {
    for (const t of PORT_TYPES) expect(isCompatible(t, t)).toBe(true);
  });

  test("異なる型は接続非互換（MVP は厳密一致）", () => {
    expect(isCompatible("number", "vec3")).toBe(false);
    expect(isCompatible("pose", "audio")).toBe(false);
    expect(isCompatible("texture", "number")).toBe(false);
    // #128: audioSignal（実音声信号）と audio（解析結果）は別物・非互換
    expect(isCompatible("audioSignal", "audio")).toBe(false);
    expect(isCompatible("audio", "audioSignal")).toBe(false);
  });
});
