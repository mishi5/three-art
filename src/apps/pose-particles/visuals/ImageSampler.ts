/**
 * 画像 (RGBA バイト列) → 粒子グリッド (gridW × gridH の RGB Float32Array) へのサンプリング。
 *
 * - ブロック平均でリサンプル (gridW <= srcW のとき)
 * - グリッドが画像より細かい場合は最近傍フォールバック
 * - 出力は行優先 (row-major)、gy=0 が画像の上端 (y=0)
 */

export interface ImageGrid {
  /** RGB を [0..1] 範囲で gridW * gridH * 3 個並べた配列 (row-major) */
  colors: Float32Array;
  /** 画像のアスペクト比 (W/H) — 平面サイズ計算に使う */
  imageAspect: number;
}

export function sampleRgbaToGrid(
  rgba: Uint8ClampedArray,
  srcW: number,
  srcH: number,
  gridW: number,
  gridH: number,
): ImageGrid {
  if (rgba.length !== srcW * srcH * 4) {
    throw new Error(`rgba length ${rgba.length} does not match ${srcW}x${srcH}x4`);
  }
  if (gridW <= 0 || gridH <= 0 || srcW <= 0 || srcH <= 0) {
    throw new Error(`invalid dimensions: src ${srcW}x${srcH} grid ${gridW}x${gridH}`);
  }

  const out = new Float32Array(gridW * gridH * 3);
  const inv255 = 1 / 255;

  for (let gy = 0; gy < gridH; gy++) {
    const syLo = Math.floor((gy / gridH) * srcH);
    const syHi = Math.floor(((gy + 1) / gridH) * srcH);
    for (let gx = 0; gx < gridW; gx++) {
      const sxLo = Math.floor((gx / gridW) * srcW);
      const sxHi = Math.floor(((gx + 1) / gridW) * srcW);

      let r = 0, g = 0, b = 0, count = 0;
      for (let sy = syLo; sy < syHi; sy++) {
        for (let sx = sxLo; sx < sxHi; sx++) {
          const i = (sy * srcW + sx) * 4;
          r += rgba[i + 0]! * inv255;
          g += rgba[i + 1]! * inv255;
          b += rgba[i + 2]! * inv255;
          count++;
        }
      }
      if (count === 0) {
        // グリッドが画像より細かい場合は最近傍 (中心サンプル) で埋める
        const sx = Math.min(srcW - 1, Math.floor(((gx + 0.5) / gridW) * srcW));
        const sy = Math.min(srcH - 1, Math.floor(((gy + 0.5) / gridH) * srcH));
        const i = (sy * srcW + sx) * 4;
        r = rgba[i + 0]! * inv255;
        g = rgba[i + 1]! * inv255;
        b = rgba[i + 2]! * inv255;
        count = 1;
      }
      const o = (gy * gridW + gx) * 3;
      out[o + 0] = r / count;
      out[o + 1] = g / count;
      out[o + 2] = b / count;
    }
  }

  return { colors: out, imageAspect: srcW / srcH };
}

/**
 * HTMLImageElement を gridW × gridH の RGB Float32Array に変換する (ブラウザ環境専用)。
 * オフスクリーン canvas で drawImage → getImageData してリサンプリングする。
 */
export function sampleImageToGrid(
  image: HTMLImageElement,
  gridW: number,
  gridH: number,
): ImageGrid {
  const srcW = image.naturalWidth;
  const srcH = image.naturalHeight;
  if (srcW <= 0 || srcH <= 0) {
    throw new Error(`image not loaded (naturalWidth=${srcW}, naturalHeight=${srcH})`);
  }
  const canvas = document.createElement("canvas");
  canvas.width = srcW;
  canvas.height = srcH;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("2d canvas context not available");
  ctx.drawImage(image, 0, 0, srcW, srcH);
  const imageData = ctx.getImageData(0, 0, srcW, srcH);
  return sampleRgbaToGrid(imageData.data, srcW, srcH, gridW, gridH);
}
