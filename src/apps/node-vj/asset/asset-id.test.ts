import { expect, test, describe } from "bun:test";
import { hashBytes, hashFile } from "./asset-id";

describe("asset-id", () => {
  test("同一バイト列は同一ハッシュ・異なるバイト列は別ハッシュ", async () => {
    const a = await hashBytes(new Uint8Array([1, 2, 3]).buffer);
    const b = await hashBytes(new Uint8Array([1, 2, 3]).buffer);
    const c = await hashBytes(new Uint8Array([1, 2, 4]).buffer);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
  test("hashFile は arrayBuffer を読んでハッシュ化", async () => {
    const buf = new Uint8Array([9, 9, 9]).buffer;
    const file = { arrayBuffer: async () => buf };
    expect(await hashFile(file)).toBe(await hashBytes(buf));
  });
});
