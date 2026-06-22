import type { AssetKind } from "./asset-kind";

/** アスペクト比を保ったまま max 矩形に収まる寸法を返す。拡大はしない。最小 1px。 */
export function fitThumbnailSize(srcW: number, srcH: number, maxW: number, maxH: number): { w: number; h: number } {
  if (srcW <= 0 || srcH <= 0) return { w: 1, h: 1 };
  const scale = Math.min(maxW / srcW, maxH / srcH, 1);
  return { w: Math.max(1, Math.round(srcW * scale)), h: Math.max(1, Math.round(srcH * scale)) };
}

export const THUMB_W = 160;
export const THUMB_H = 120;

/** 種別別にサムネ Blob を生成する（DOM 依存・本番のみ）。失敗時は null。
 *  image=縮小描画 / video=0.1 秒地点の 1 フレーム / audio=null（パネル側でアイコン表示）。 */
export async function generateThumbnail(file: File, kind: AssetKind): Promise<Blob | null> {
  try {
    if (kind === "image") return await thumbFromImage(file);
    if (kind === "video") return await thumbFromVideo(file);
    return null; // audio はサムネなし（パネルでアイコン）
  } catch {
    return null;
  }
}

async function drawToBlob(src: CanvasImageSource, w: number, h: number): Promise<Blob | null> {
  const fit = fitThumbnailSize(w, h, THUMB_W, THUMB_H);
  const canvas = document.createElement("canvas");
  canvas.width = fit.w; canvas.height = fit.h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(src, 0, 0, fit.w, fit.h);
  return await new Promise((res) => canvas.toBlob((b) => res(b), "image/png"));
}

async function thumbFromImage(file: File): Promise<Blob | null> {
  const bmp = await createImageBitmap(file);
  try { return await drawToBlob(bmp, bmp.width, bmp.height); } finally { bmp.close(); }
}

async function thumbFromVideo(file: File): Promise<Blob | null> {
  const url = URL.createObjectURL(file);
  try {
    const v = document.createElement("video");
    v.muted = true; v.src = url;
    await new Promise<void>((res, rej) => { v.onloadeddata = () => res(); v.onerror = () => rej(new Error("video load")); });
    await new Promise<void>((res) => { v.onseeked = () => res(); v.currentTime = Math.min(0.1, v.duration || 0.1); });
    return await drawToBlob(v, v.videoWidth, v.videoHeight);
  } finally { URL.revokeObjectURL(url); }
}
