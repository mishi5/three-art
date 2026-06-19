import { expect, test, describe } from "bun:test";
import {
  MIN_SCALE, MAX_SCALE, clampScale, screenToWorld, worldToScreen, zoomAt,
} from "./viewport";

describe("clampScale", () => {
  test("範囲内はそのまま", () => {
    expect(clampScale(1)).toBe(1);
  });
  test("下限・上限でクランプ", () => {
    expect(clampScale(0.01)).toBe(MIN_SCALE);
    expect(clampScale(100)).toBe(MAX_SCALE);
  });
});

describe("screenToWorld / worldToScreen の往復", () => {
  const offset = { x: 60, y: 40 };
  const scale = 1.5;

  test("worldToScreen は scale と offset を反映", () => {
    // screen = world*scale + offset
    expect(worldToScreen(10, 20, offset, scale)).toEqual({ x: 10 * 1.5 + 60, y: 20 * 1.5 + 40 });
  });

  test("screenToWorld は逆変換", () => {
    const s = worldToScreen(33, -12, offset, scale);
    const w = screenToWorld(s.x, s.y, offset, scale);
    expect(w.x).toBeCloseTo(33, 6);
    expect(w.y).toBeCloseTo(-12, 6);
  });

  test("scale=1 は従来の offset 平行移動（world = screen - offset）", () => {
    expect(screenToWorld(100, 80, offset, 1)).toEqual({ x: 40, y: 40 });
  });
});

describe("zoomAt（カーソル中心ズーム）", () => {
  const offset = { x: 60, y: 40 };
  const scale = 1.0;

  test("カーソル下のワールド点はズーム後も同じスクリーン位置に留まる", () => {
    const cx = 300, cy = 200;
    const before = screenToWorld(cx, cy, offset, scale);
    const r = zoomAt(cx, cy, offset, scale, 1.2);
    const after = worldToScreen(before.x, before.y, r.offset, r.scale);
    expect(after.x).toBeCloseTo(cx, 6);
    expect(after.y).toBeCloseTo(cy, 6);
  });

  test("factor>1 で拡大、factor<1 で縮小", () => {
    expect(zoomAt(0, 0, offset, 1, 1.25).scale).toBeCloseTo(1.25, 6);
    expect(zoomAt(0, 0, offset, 1, 0.8).scale).toBeCloseTo(0.8, 6);
  });

  test("上限・下限を超えない（クランプ時はカーソル点も保持）", () => {
    const r = zoomAt(150, 150, offset, MAX_SCALE, 4);
    expect(r.scale).toBe(MAX_SCALE);
    // クランプで scale 変化なしでも offset は維持される（カーソル点不動）
    const before = screenToWorld(150, 150, offset, MAX_SCALE);
    const after = worldToScreen(before.x, before.y, r.offset, r.scale);
    expect(after.x).toBeCloseTo(150, 6);
    expect(after.y).toBeCloseTo(150, 6);
  });
});
