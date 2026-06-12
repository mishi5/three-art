// アスペクト維持の contain 矩形計算（#79・純粋）。
export interface FitRect { x: number; y: number; w: number; h: number }

/** src を dst にレターボックスで収める描画矩形（dst 内中央寄せ）。 */
export function containRect(srcW: number, srcH: number, dstW: number, dstH: number): FitRect {
  if (srcW <= 0 || srcH <= 0) return { x: 0, y: 0, w: dstW, h: dstH };
  const scale = Math.min(dstW / srcW, dstH / srcH);
  const w = srcW * scale;
  const h = srcH * scale;
  return { x: (dstW - w) / 2, y: (dstH - h) / 2, w, h };
}
