import { describe, expect, test } from "bun:test";
import { fileHash } from "./fileHash";

describe("fileHash", () => {
  test("同じ name/size/headBytes なら同じハッシュ", () => {
    const head = new Uint8Array([1, 2, 3, 4, 5]);
    expect(fileHash("a.mp3", 1000, head)).toBe(fileHash("a.mp3", 1000, head));
  });

  test("name が違うとハッシュが変わる", () => {
    const head = new Uint8Array([1, 2, 3]);
    expect(fileHash("a.mp3", 1000, head)).not.toBe(fileHash("b.mp3", 1000, head));
  });

  test("size が違うとハッシュが変わる", () => {
    const head = new Uint8Array([1, 2, 3]);
    expect(fileHash("a.mp3", 1000, head)).not.toBe(fileHash("a.mp3", 2000, head));
  });

  test("headBytes が違うとハッシュが変わる", () => {
    expect(fileHash("a.mp3", 1000, new Uint8Array([1, 2, 3])))
      .not.toBe(fileHash("a.mp3", 1000, new Uint8Array([1, 2, 4])));
  });

  test("空 headBytes でも安定して動く", () => {
    expect(fileHash("a.mp3", 0, new Uint8Array(0))).toBe(fileHash("a.mp3", 0, new Uint8Array(0)));
  });
});
