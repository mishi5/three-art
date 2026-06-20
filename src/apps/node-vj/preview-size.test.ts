import { expect, test, describe } from "bun:test";
import { previewSize, PREVIEW_SMALL_W, PREVIEW_SMALL_H } from "./preview-size";

describe("previewSize (#136)", () => {
  test("小窓は固定 320x180", () => {
    expect(previewSize(false, 1920, 1080)).toEqual({ w: PREVIEW_SMALL_W, h: PREVIEW_SMALL_H });
  });
  test("拡大はビューポート全体（全画面）", () => {
    expect(previewSize(true, 1920, 1080)).toEqual({ w: 1920, h: 1080 });
    expect(previewSize(true, 800, 600)).toEqual({ w: 800, h: 600 });
  });
});
