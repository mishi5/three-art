import { describe, expect, test } from "bun:test";
import { setByPath } from "./setByPath";

describe("setByPath", () => {
  test("トップレベルのフィールドを書き込む", () => {
    const obj: Record<string, unknown> = { a: 1, b: 2 };
    setByPath(obj, "a", 99);
    expect(obj.a).toBe(99);
  });

  test("ネストしたフィールドを書き込む", () => {
    const obj = { color: { hueBase: 0.5 }, blur: { strength: 0.0 } };
    setByPath(obj as unknown as Record<string, unknown>, "color.hueBase", 0.8);
    setByPath(obj as unknown as Record<string, unknown>, "blur.strength", 1.2);
    expect(obj.color.hueBase).toBe(0.8);
    expect(obj.blur.strength).toBe(1.2);
  });

  test("途中のキーが無いパスは何もしない (存在しないネスト先は作らない)", () => {
    const obj: Record<string, unknown> = { a: { b: 1 } };
    setByPath(obj, "x.y.z", 42);
    expect(obj).toEqual({ a: { b: 1 } });
  });

  test("3 段以上のネストでも動く", () => {
    const obj = { a: { b: { c: 0 } } };
    setByPath(obj as unknown as Record<string, unknown>, "a.b.c", 7);
    expect(obj.a.b.c).toBe(7);
  });
});
