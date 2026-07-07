// #227: ノードカテゴリの役割ベース 7 種への再整理。
// 全ノードの category が NODE_CATEGORIES（graph/node-type.ts・単一情報源）の
// いずれかであることを registry 走査で網羅検証する。
import { describe, expect, test } from "bun:test";
import { NODE_CATEGORIES } from "../graph/node-type";
import { createDefaultRegistry } from "./registry";

describe("createDefaultRegistry のカテゴリ整合（#227）", () => {
  const defs = createDefaultRegistry().list();

  test("全ノードが category を持ち、NODE_CATEGORIES のいずれかである", () => {
    const bad = defs
      .filter((d) => !d.category || !NODE_CATEGORIES.includes(d.category))
      .map((d) => d.type);
    expect(bad).toEqual([]);
  });

  test("7 カテゴリすべてに 1 つ以上のノードがある（空カテゴリを作らない）", () => {
    const used = new Set(defs.map((d) => d.category));
    for (const cat of NODE_CATEGORIES) {
      expect(used.has(cat)).toBe(true);
    }
  });
});
