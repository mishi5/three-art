import { expect, test, describe } from "bun:test";
import { GraphStore, memoryAdapter } from "./graph-store";

describe("GraphStore", () => {
  test("save / list / load / remove の CRUD", () => {
    const s = new GraphStore(memoryAdapter());
    expect(s.list()).toEqual([]);
    s.save("intro", "version: 1");
    s.save("drop", "version: 1\n# drop");
    expect(s.list()).toEqual(["intro", "drop"]);
    expect(s.load("intro")).toBe("version: 1");
    expect(s.load("nothing")).toBeNull();
    s.remove("intro");
    expect(s.list()).toEqual(["drop"]);
    expect(s.load("intro")).toBeNull();
  });

  test("同名 save は上書き（index 重複なし）", () => {
    const s = new GraphStore(memoryAdapter());
    s.save("a", "1");
    s.save("a", "2");
    expect(s.list()).toEqual(["a"]);
    expect(s.load("a")).toBe("2");
  });

  test("空名は throw", () => {
    const s = new GraphStore(memoryAdapter());
    expect(() => s.save("  ", "x")).toThrow();
  });
});
