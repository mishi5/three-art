import { expect, test, describe } from "bun:test";
import { transformUV, wrapCoord, sampleUV, isOutOfBounds, type TexTransformParams } from "./texture-transform-logic";

const ID: TexTransformParams = {
  offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1, rotation: 0,
  flipX: false, flipY: false, wrap: "clamp",
};

describe("transformUV（サンプル UV の逆変換・wrap 前）", () => {
  test("恒等変換は入力 UV をそのまま返す", () => {
    const r = transformUV(0.3, 0.7, ID, 1);
    expect(r.u).toBeCloseTo(0.3, 6);
    expect(r.v).toBeCloseTo(0.7, 6);
  });

  test("offsetX は画像を平行移動（サンプルは逆方向）", () => {
    const r = transformUV(0.5, 0.5, { ...ID, offsetX: 0.1 }, 1);
    expect(r.u).toBeCloseTo(0.4, 6);
  });

  test("scaleX>1 は中心方向へズームイン", () => {
    const r = transformUV(1.0, 0.5, { ...ID, scaleX: 2 }, 1);
    expect(r.u).toBeCloseTo(0.75, 6); // (1-0.5)/2 + 0.5
  });

  test("flipX は中心 0.5 で左右反転", () => {
    const r = transformUV(0.2, 0.5, { ...ID, flipX: true }, 1);
    expect(r.u).toBeCloseTo(0.8, 6);
  });

  test("回転 90°（aspect=1）で軸が入れ替わる", () => {
    const r = transformUV(1.0, 0.5, { ...ID, rotation: Math.PI / 2 }, 1);
    expect(r.u).toBeCloseTo(0.5, 6);
    expect(r.v).toBeCloseTo(0.0, 6);
  });
});

describe("wrapCoord", () => {
  test("clamp は 0..1 に丸める", () => {
    expect(wrapCoord(1.2, "clamp")).toBeCloseTo(1, 6);
    expect(wrapCoord(-0.3, "clamp")).toBeCloseTo(0, 6);
    expect(wrapCoord(0.4, "clamp")).toBeCloseTo(0.4, 6);
  });
  test("repeat は小数部（タイル）", () => {
    expect(wrapCoord(1.2, "repeat")).toBeCloseTo(0.2, 6);
    expect(wrapCoord(-0.2, "repeat")).toBeCloseTo(0.8, 6);
  });
  test("mirror は三角波で折り返す", () => {
    expect(wrapCoord(1.2, "mirror")).toBeCloseTo(0.8, 6);
    expect(wrapCoord(2.3, "mirror")).toBeCloseTo(0.3, 6);
    expect(wrapCoord(-0.2, "mirror")).toBeCloseTo(0.2, 6);
  });
  test("none は座標を変えない（可視判定は別）", () => {
    expect(wrapCoord(1.2, "none")).toBeCloseTo(1.2, 6);
    expect(wrapCoord(-0.3, "none")).toBeCloseTo(-0.3, 6);
  });
});

describe("isOutOfBounds（none=描画しない の可視判定）", () => {
  test("範囲内は false", () => {
    expect(isOutOfBounds(0.0, 1.0)).toBe(false);
    expect(isOutOfBounds(0.5, 0.5)).toBe(false);
  });
  test("いずれかが [0,1] 外なら true", () => {
    expect(isOutOfBounds(-0.01, 0.5)).toBe(true);
    expect(isOutOfBounds(0.5, 1.01)).toBe(true);
  });
});

describe("sampleUV（transform → wrap 合成）", () => {
  test("offset で範囲外になった分は wrap される（repeat）", () => {
    const r = sampleUV(0.05, 0.5, { ...ID, offsetX: 0.1, wrap: "repeat" }, 1);
    // u: 0.05 - 0.1 = -0.05 → repeat → 0.95
    expect(r.u).toBeCloseTo(0.95, 6);
  });
});
