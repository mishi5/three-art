import { expect, test, describe } from "bun:test";
import { containRect, containScale } from "./fit";

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

describe("containScale (#219)", () => {
  test("同比は全面スケール(1,1)", () => {
    expect(containScale(320, 180, 160, 90)).toEqual({ x: 1, y: 1 });
  });
  test("4:3 を 16:9 に → 横を縮めて上下は全面", () => {
    const s = containScale(640, 480, 160, 90);
    expect(s.x).toBeCloseTo(0.75, 6); // 120/160
    expect(s.y).toBe(1);
  });
  test("縦長 → 縦は全面・横を縮める", () => {
    const s = containScale(90, 160, 160, 90);
    expect(s.y).toBe(1);
    expect(s.x).toBeCloseTo(50.625 / 160, 6);
  });
  test("不正サイズ・dst 0 は全面フォールバック(1,1)", () => {
    expect(containScale(0, 0, 160, 90)).toEqual({ x: 1, y: 1 });
    expect(containScale(320, 180, 0, 0)).toEqual({ x: 1, y: 1 });
  });
});
