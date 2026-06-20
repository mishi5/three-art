import { expect, test, describe } from "bun:test";
import { CATEGORY_ORDER, groupNodesByCategory } from "./node-menu";

describe("groupNodesByCategory", () => {
  test("カテゴリ順（input→process→visual→effect→output）に並べる", () => {
    const defs = [
      { type: "Screen", category: "output" },
      { type: "Number", category: "input" },
      { type: "Multiply", category: "process" },
      { type: "Blur", category: "effect" },
      { type: "RainVisual", category: "visual" },
    ];
    const groups = groupNodesByCategory(defs);
    expect(groups.map((g) => g.category)).toEqual([...CATEGORY_ORDER]);
    expect(groups.find((g) => g.category === "input")?.types).toEqual(["Number"]);
    expect(groups.find((g) => g.category === "output")?.types).toEqual(["Screen"]);
  });

  test("同一カテゴリ内は入力（レジストリ）順を維持", () => {
    const defs = [
      { type: "Multiply", category: "process" },
      { type: "Add", category: "process" },
      { type: "Sine", category: "process" },
    ];
    const groups = groupNodesByCategory(defs);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.types).toEqual(["Multiply", "Add", "Sine"]);
  });

  test("空カテゴリは結果に含めない", () => {
    const groups = groupNodesByCategory([{ type: "Number", category: "input" }]);
    expect(groups.map((g) => g.category)).toEqual(["input"]);
  });

  test("未知/未設定カテゴリは末尾 other にまとめる", () => {
    const defs = [
      { type: "Number", category: "input" },
      { type: "Weird", category: "mystery" },
      { type: "NoCat" },
    ];
    const groups = groupNodesByCategory(defs);
    expect(groups[groups.length - 1]!.category).toBe("other");
    expect(groups[groups.length - 1]!.types).toEqual(["Weird", "NoCat"]);
  });
});
