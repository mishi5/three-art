import { expect, test, describe } from "bun:test";
import { memoryBinaryStore } from "./binary-store";

describe("memoryBinaryStore", () => {
  test("put/getFile/has/delete の CRUD", async () => {
    const s = memoryBinaryStore();
    expect(await s.has("a")).toBe(false);
    await s.put("a", new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }));
    expect(await s.has("a")).toBe(true);
    const f = await s.getFile("a");
    expect(f).not.toBeNull();
    expect(await f!.arrayBuffer()).toEqual(new Uint8Array([1, 2, 3]).buffer);
    await s.delete("a");
    expect(await s.has("a")).toBe(false);
    expect(await s.getFile("a")).toBeNull();
  });
});
