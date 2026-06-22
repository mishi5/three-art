import { expect, test, describe } from "bun:test";
import { AssetLibrary } from "./asset-library";
import { memoryBinaryStore } from "./binary-store";
import { memoryMetaStore } from "./meta-store";

function lib() {
  let t = 0;
  return new AssetLibrary({
    binary: memoryBinaryStore(),
    meta: memoryMetaStore(),
    makeThumbnail: async () => null,
    now: () => ++t,
  });
}
function file(name: string, type: string, bytes: number[]): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

describe("AssetLibrary", () => {
  test("add で meta 登録・getFile で本体取得", async () => {
    const l = lib();
    const m = await l.add(file("a.png", "image/png", [1, 2, 3]));
    expect(m).not.toBeNull();
    expect(m!.kind).toBe("image");
    expect((await l.list()).length).toBe(1);
    const f = await l.getFile(m!.id);
    expect(await f!.arrayBuffer()).toEqual(new Uint8Array([1, 2, 3]).buffer);
  });
  test("同一内容は重複排除（id 一致・件数 1）", async () => {
    const l = lib();
    const a = await l.add(file("a.png", "image/png", [1, 2, 3]));
    const b = await l.add(file("copy.png", "image/png", [1, 2, 3]));
    expect(b!.id).toBe(a!.id);
    expect((await l.list()).length).toBe(1);
  });
  test("対象外 mime は null・登録されない", async () => {
    const l = lib();
    expect(await l.add(file("x.json", "application/json", [1]))).toBeNull();
    expect((await l.list()).length).toBe(0);
  });
  test("remove で消える", async () => {
    const l = lib();
    const m = await l.add(file("a.png", "image/png", [1, 2, 3]));
    await l.remove(m!.id);
    expect((await l.list()).length).toBe(0);
    expect(await l.getFile(m!.id)).toBeNull();
  });
  test("onChange は add/remove で発火・解除できる", async () => {
    const l = lib();
    let n = 0;
    const off = l.onChange(() => { n++; });
    await l.add(file("a.png", "image/png", [1]));
    expect(n).toBe(1);
    off();
    await l.add(file("b.png", "image/png", [2]));
    expect(n).toBe(1);
  });
});
