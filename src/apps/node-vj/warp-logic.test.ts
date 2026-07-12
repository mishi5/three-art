// #282: コーナーピンワープの数理（純関数）テスト。
// 座標系は「出力表示空間」（x 右・y 下・(0,0)=左上・(1,1)=右下）で統一。
import { describe, expect, test } from "bun:test";
import {
  DEFAULT_CORNERS, IDENTITY_MAT3, WARP_MIN, WARP_MAX, WARP_PARAM_IDS,
  applyHomography, cornerParamIds, handlePoint, homographyFromCorners,
  normalizedPoint, sanitizeCorners,
  type Corners, type Mat3,
} from "./warp-logic";

/** 行列を m22=1 に正規化して比較する（射影行列はスカラー倍が同値）。 */
function normalized(m: Mat3): number[] {
  const s = m[8]!;
  return [...m].map((v) => v / s);
}

function expectMat3Close(a: Mat3, b: Mat3, eps = 1e-9): void {
  const na = normalized(a), nb = normalized(b);
  for (let i = 0; i < 9; i++) expect(Math.abs(na[i]! - nb[i]!)).toBeLessThan(eps);
}

function expectPointClose(p: { x: number; y: number }, q: { x: number; y: number }, eps = 1e-9): void {
  expect(Math.abs(p.x - q.x)).toBeLessThan(eps);
  expect(Math.abs(p.y - q.y)).toBeLessThan(eps);
}

describe("homographyFromCorners (#282)", () => {
  test("既定 4 隅（tl=(0,0) tr=(1,0) bl=(0,1) br=(1,1)）は恒等行列", () => {
    const { forward, inverse } = homographyFromCorners(DEFAULT_CORNERS);
    expectMat3Close(forward, IDENTITY_MAT3);
    expectMat3Close(inverse, IDENTITY_MAT3);
  });

  test("平行移動（全隅 +0.25）は任意点を +0.25 に写す", () => {
    const c: Corners = {
      tl: { x: 0.25, y: 0.25 }, tr: { x: 1.25, y: 0.25 },
      bl: { x: 0.25, y: 1.25 }, br: { x: 1.25, y: 1.25 },
    };
    const { forward } = homographyFromCorners(c);
    expectPointClose(applyHomography(forward, { x: 0.5, y: 0.5 }), { x: 0.75, y: 0.75 });
    expectPointClose(applyHomography(forward, { x: 0, y: 0 }), { x: 0.25, y: 0.25 });
  });

  test("スケール（半分に縮小）は中心点を正しく写す", () => {
    const c: Corners = {
      tl: { x: 0, y: 0 }, tr: { x: 0.5, y: 0 },
      bl: { x: 0, y: 0.5 }, br: { x: 0.5, y: 0.5 },
    };
    const { forward } = homographyFromCorners(c);
    expectPointClose(applyHomography(forward, { x: 1, y: 1 }), { x: 0.5, y: 0.5 });
    expectPointClose(applyHomography(forward, { x: 0.5, y: 0.5 }), { x: 0.25, y: 0.25 });
  });

  test("台形は 4 隅を正確に写す", () => {
    const c: Corners = {
      tl: { x: 0, y: 0 }, tr: { x: 1, y: 0 },
      bl: { x: 0.25, y: 1 }, br: { x: 0.75, y: 1 },
    };
    const { forward } = homographyFromCorners(c);
    expectPointClose(applyHomography(forward, { x: 0, y: 0 }), c.tl);
    expectPointClose(applyHomography(forward, { x: 1, y: 0 }), c.tr);
    expectPointClose(applyHomography(forward, { x: 0, y: 1 }), c.bl);
    expectPointClose(applyHomography(forward, { x: 1, y: 1 }), c.br);
  });

  test("台形は非アフィン（射影）: 辺の中点が両端の平均に写らない", () => {
    const c: Corners = {
      tl: { x: 0, y: 0 }, tr: { x: 1, y: 0 },
      bl: { x: 0.25, y: 1 }, br: { x: 0.75, y: 1 },
    };
    const { forward } = homographyFromCorners(c);
    // 左辺の中点 (0, 0.5)。アフィンなら tl と bl の平均 (0.125, 0.5) に写るはず。
    const mid = applyHomography(forward, { x: 0, y: 0.5 });
    expect(Math.abs(mid.x - 0.125) + Math.abs(mid.y - 0.5)).toBeGreaterThan(1e-3);
  });

  test("逆行列: H·H⁻¹ ≈ I（点の往復で確認）", () => {
    const c: Corners = {
      tl: { x: 0.1, y: -0.05 }, tr: { x: 0.9, y: 0.1 },
      bl: { x: -0.1, y: 1.05 }, br: { x: 1.2, y: 0.8 },
    };
    const { forward, inverse } = homographyFromCorners(c);
    for (const p of [{ x: 0.3, y: 0.7 }, { x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0.5, y: 0.5 }]) {
      expectPointClose(applyHomography(inverse, applyHomography(forward, p)), p, 1e-7);
    }
  });

  test("退化（3 隅が同一直線上）は forward/inverse とも恒等にフォールバック", () => {
    const c: Corners = {
      tl: { x: 0, y: 0 }, tr: { x: 0.5, y: 0 },
      br: { x: 1, y: 0 }, bl: { x: 0, y: 1 },
    };
    const { forward, inverse } = homographyFromCorners(c);
    expectMat3Close(forward, IDENTITY_MAT3);
    expectMat3Close(inverse, IDENTITY_MAT3);
  });

  test("退化（全隅が同一点＝面積ゼロ）は恒等にフォールバック", () => {
    const p = { x: 0.5, y: 0.5 };
    const { forward, inverse } = homographyFromCorners({ tl: p, tr: p, bl: p, br: p });
    expectMat3Close(forward, IDENTITY_MAT3);
    expectMat3Close(inverse, IDENTITY_MAT3);
  });

  test("非有限値（NaN/Infinity）は恒等にフォールバック（例外を投げない）", () => {
    const c: Corners = {
      tl: { x: NaN, y: 0 }, tr: { x: 1, y: 0 },
      bl: { x: 0, y: 1 }, br: { x: Infinity, y: 1 },
    };
    const { forward, inverse } = homographyFromCorners(c);
    expectMat3Close(forward, IDENTITY_MAT3);
    expectMat3Close(inverse, IDENTITY_MAT3);
  });
});

describe("sanitizeCorners (#282)", () => {
  test("8 param から corners を組み立てる", () => {
    const c = sanitizeCorners({
      tlX: 0.1, tlY: 0.2, trX: 0.9, trY: 0.1,
      blX: 0, blY: 1.1, brX: 1.2, brY: 0.9,
    });
    expect(c).toEqual({
      tl: { x: 0.1, y: 0.2 }, tr: { x: 0.9, y: 0.1 },
      bl: { x: 0, y: 1.1 }, br: { x: 1.2, y: 0.9 },
    });
  });

  test("非有限・欠落・非数値は既定値へフォールバック", () => {
    const c = sanitizeCorners({ tlX: NaN, tlY: "x", trX: Infinity });
    expect(c).toEqual(DEFAULT_CORNERS);
  });

  test("params 未定義は既定 corners", () => {
    expect(sanitizeCorners(undefined)).toEqual(DEFAULT_CORNERS);
  });

  test("WARP_PARAM_IDS は 4 隅 × xy の 8 個で命名が一貫している", () => {
    expect(WARP_PARAM_IDS).toEqual(["tlX", "tlY", "trX", "trY", "blX", "blY", "brX", "brY"]);
  });

  test("cornerParamIds は隅名 → param id ペアを返す", () => {
    expect(cornerParamIds("tl")).toEqual({ x: "tlX", y: "tlY" });
    expect(cornerParamIds("br")).toEqual({ x: "brX", y: "brY" });
  });
});

describe("ハンドル座標変換 (#282)", () => {
  const rect = { x: 100, y: 50, w: 800, h: 450 }; // contain 後の実表示矩形

  test("handlePoint: 正規化コーナー → 表示矩形内のピクセル座標", () => {
    expect(handlePoint({ x: 0, y: 0 }, rect)).toEqual({ x: 100, y: 50 });
    expect(handlePoint({ x: 1, y: 1 }, rect)).toEqual({ x: 900, y: 500 });
    expect(handlePoint({ x: 0.5, y: 0.5 }, rect)).toEqual({ x: 500, y: 275 });
  });

  test("normalizedPoint: ピクセル座標 → 正規化（handlePoint の逆変換）", () => {
    expectPointClose(normalizedPoint(500, 275, rect), { x: 0.5, y: 0.5 });
    expectPointClose(normalizedPoint(100, 50, rect), { x: 0, y: 0 });
  });

  test("normalizedPoint: param の min/max（-0.5..1.5）へクランプする", () => {
    expect(normalizedPoint(-10000, 275, rect).x).toBe(WARP_MIN);
    expect(normalizedPoint(10000, 275, rect).x).toBe(WARP_MAX);
    expect(normalizedPoint(500, -10000, rect).y).toBe(WARP_MIN);
    expect(normalizedPoint(500, 10000, rect).y).toBe(WARP_MAX);
  });

  test("normalizedPoint: 幅 0 の矩形は既定 (0,0) を返す（NaN を作らない）", () => {
    expect(normalizedPoint(10, 10, { x: 0, y: 0, w: 0, h: 0 })).toEqual({ x: 0, y: 0 });
  });
});
