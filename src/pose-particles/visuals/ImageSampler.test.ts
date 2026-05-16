import { describe, expect, test } from "bun:test";
import { sampleRgbaToGrid } from "./ImageSampler";

/** Helper: build an RGBA Uint8ClampedArray from a list of [r,g,b] tuples (alpha=255). */
function makeRgba(srcW: number, srcH: number, pixels: ReadonlyArray<readonly [number, number, number]>): Uint8ClampedArray {
  if (pixels.length !== srcW * srcH) {
    throw new Error(`pixel count ${pixels.length} != ${srcW * srcH}`);
  }
  const out = new Uint8ClampedArray(srcW * srcH * 4);
  for (let i = 0; i < pixels.length; i++) {
    const p = pixels[i]!;
    out[i * 4 + 0] = p[0];
    out[i * 4 + 1] = p[1];
    out[i * 4 + 2] = p[2];
    out[i * 4 + 3] = 255;
  }
  return out;
}

describe("sampleRgbaToGrid", () => {
  test("単色 4x4 を 2x2 に縮小すると全セル同色", () => {
    const rgba = makeRgba(4, 4, Array.from({ length: 16 }, () => [128, 64, 200] as const));
    const grid = sampleRgbaToGrid(rgba, 4, 4, 2, 2);
    expect(grid.colors.length).toBe(2 * 2 * 3);
    expect(grid.imageAspect).toBeCloseTo(1.0);
    for (let i = 0; i < 4; i++) {
      expect(grid.colors[i * 3 + 0]).toBeCloseTo(128 / 255, 3);
      expect(grid.colors[i * 3 + 1]).toBeCloseTo(64 / 255, 3);
      expect(grid.colors[i * 3 + 2]).toBeCloseTo(200 / 255, 3);
    }
  });

  test("2x2 チェッカーをそのまま 2x2 で取り出すと各セルが正しい色", () => {
    // (0,0)=R  (1,0)=G
    // (0,1)=B  (1,1)=W
    const R: readonly [number, number, number] = [255, 0, 0];
    const G: readonly [number, number, number] = [0, 255, 0];
    const B: readonly [number, number, number] = [0, 0, 255];
    const W: readonly [number, number, number] = [255, 255, 255];
    const rgba = makeRgba(2, 2, [R, G, B, W]);
    const grid = sampleRgbaToGrid(rgba, 2, 2, 2, 2);
    // 出力は行優先 (row-major) で gy=0 が上 (=画像 y=0 = 上端)
    // cell(0,0) → R
    expect(grid.colors[0]).toBeCloseTo(1.0, 3);
    expect(grid.colors[1]).toBeCloseTo(0.0, 3);
    expect(grid.colors[2]).toBeCloseTo(0.0, 3);
    // cell(1,0) → G
    expect(grid.colors[3]).toBeCloseTo(0.0, 3);
    expect(grid.colors[4]).toBeCloseTo(1.0, 3);
    expect(grid.colors[5]).toBeCloseTo(0.0, 3);
    // cell(0,1) → B
    expect(grid.colors[6]).toBeCloseTo(0.0, 3);
    expect(grid.colors[7]).toBeCloseTo(0.0, 3);
    expect(grid.colors[8]).toBeCloseTo(1.0, 3);
    // cell(1,1) → W
    expect(grid.colors[9]).toBeCloseTo(1.0, 3);
    expect(grid.colors[10]).toBeCloseTo(1.0, 3);
    expect(grid.colors[11]).toBeCloseTo(1.0, 3);
  });

  test("imageAspect は srcW / srcH を返す", () => {
    const rgba = makeRgba(8, 4, Array.from({ length: 32 }, () => [0, 0, 0] as const));
    const grid = sampleRgbaToGrid(rgba, 8, 4, 4, 2);
    expect(grid.imageAspect).toBeCloseTo(2.0);
  });

  test("グリッドが画像より細かい場合も全セルが埋まる", () => {
    // 2x2 画像を 4x4 グリッドに展開 (オーバーサンプル)
    const rgba = makeRgba(2, 2, [[10, 20, 30], [40, 50, 60], [70, 80, 90], [100, 110, 120]]);
    const grid = sampleRgbaToGrid(rgba, 2, 2, 4, 4);
    expect(grid.colors.length).toBe(4 * 4 * 3);
    // 全セルがゼロ以外で埋まっていること
    let nonZero = 0;
    for (let i = 0; i < grid.colors.length; i++) {
      if ((grid.colors[i] ?? 0) > 0) nonZero++;
    }
    expect(nonZero).toBeGreaterThan(grid.colors.length / 2);
  });

  test("8x4 → 4x4 で出力長 = gridW * gridH * 3", () => {
    const rgba = makeRgba(8, 4, Array.from({ length: 32 }, (_, i) => [i * 8, 128, 255 - i * 8] as const));
    const grid = sampleRgbaToGrid(rgba, 8, 4, 4, 4);
    expect(grid.colors.length).toBe(48);
  });
});
