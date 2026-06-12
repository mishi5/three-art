import { expect, test, describe } from "bun:test";
import { containRect } from "./fit";

describe("containRect", () => {
  test("4:3 を 16:9 に → 左右レターボックス", () => {
    const r = containRect(640, 480, 160, 90);
    expect(r.h).toBe(90);
    expect(r.w).toBe(120);
    expect(r.x).toBe(20);
    expect(r.y).toBe(0);
  });
  test("同比は全面", () => {
    expect(containRect(320, 180, 160, 90)).toEqual({ x: 0, y: 0, w: 160, h: 90 });
  });
  test("縦長 → 上下センタリングでなく左右に余白（高さ基準）", () => {
    const r = containRect(90, 160, 160, 90);
    expect(r.h).toBe(90);
    expect(r.w).toBeCloseTo(50.625, 3);
  });
  test("不正サイズは全面フォールバック", () => {
    expect(containRect(0, 0, 160, 90)).toEqual({ x: 0, y: 0, w: 160, h: 90 });
  });
});
