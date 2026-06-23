import { expect, test, describe } from "bun:test";
import { fitThumbnailSize } from "./thumbnail";

describe("fitThumbnailSize", () => {
  test("横長は幅に合わせて縮小", () => {
    expect(fitThumbnailSize(1920, 1080, 160, 120)).toEqual({ w: 160, h: 90 });
  });
  test("縦長は高さに合わせて縮小", () => {
    expect(fitThumbnailSize(1080, 1920, 160, 120)).toEqual({ w: 68, h: 120 });
  });
  test("元が小さい場合は拡大せずそのまま", () => {
    expect(fitThumbnailSize(80, 60, 160, 120)).toEqual({ w: 80, h: 60 });
  });
  test("0 や負値でも最小 1px を返す", () => {
    expect(fitThumbnailSize(0, 0, 160, 120)).toEqual({ w: 1, h: 1 });
  });
});
