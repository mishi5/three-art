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

/**
 * contain 矩形を dst で正規化した NDC スケール（#219・純粋）。
 * 全面クアッド(2x2)を張った mesh に対する `scale.set(x, y, 1)` に使う。
 * dst が 0 以下や不正サイズのときは全面 (1,1) にフォールバックする。
 */
export function containScale(srcW: number, srcH: number, dstW: number, dstH: number): { x: number; y: number } {
  if (dstW <= 0 || dstH <= 0) return { x: 1, y: 1 };
  const r = containRect(srcW, srcH, dstW, dstH);
  return { x: r.w / dstW, y: r.h / dstH };
}
