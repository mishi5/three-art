import { expect, test, describe } from "bun:test";
import { memoryMetaStore, type AssetMeta } from "./meta-store";

function meta(id: string, createdAt: number): AssetMeta {
  return { id, kind: "image", fileName: id + ".png", mime: "image/png", size: 10, thumbnail: null, createdAt };
}

describe("memoryMetaStore", () => {
  test("put/get/list/delete・list は createdAt 昇順", async () => {
    const s = memoryMetaStore();
    expect(await s.list()).toEqual([]);
    await s.put(meta("b", 200));
    await s.put(meta("a", 100));
    expect((await s.list()).map((m) => m.id)).toEqual(["a", "b"]);
    expect((await s.get("a"))?.fileName).toBe("a.png");
    expect(await s.get("x")).toBeNull();
    await s.delete("a");
    expect((await s.list()).map((m) => m.id)).toEqual(["b"]);
  });
});
