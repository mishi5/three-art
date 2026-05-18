import { describe, expect, test } from "bun:test";
import { activeModeFolders } from "./mode-folders";

describe("activeModeFolders", () => {
  test("bones: モード専用フォルダは全て非活性", () => {
    expect([...activeModeFolders("bones")]).toEqual([]);
  });

  test("cube / sphere: shape のみ活性", () => {
    expect(new Set(activeModeFolders("cube"))).toEqual(new Set(["shape"]));
    expect(new Set(activeModeFolders("sphere"))).toEqual(new Set(["shape"]));
  });

  test("lattice: wave + lattice 活性", () => {
    expect(new Set(activeModeFolders("lattice"))).toEqual(
      new Set(["wave", "lattice"]),
    );
  });

  test("image: wave + image 活性", () => {
    expect(new Set(activeModeFolders("image"))).toEqual(
      new Set(["wave", "image"]),
    );
  });

  test("rain: rain のみ活性", () => {
    expect(new Set(activeModeFolders("rain"))).toEqual(new Set(["rain"]));
  });
});
