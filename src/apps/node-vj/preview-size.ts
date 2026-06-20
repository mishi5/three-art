// #136: 出力プレビュー(PiP)のサイズ。小窓 ⇄ 全画面のトグル。
// 拡大時はビューポート全体（contain でなく画面いっぱい。renderer 側で camera aspect を合わせる）。

/** 小窓サイズ（PiP）。 */
export const PREVIEW_SMALL_W = 320;
export const PREVIEW_SMALL_H = 180;

/** large=true なら全画面（vw×vh）、false なら小窓サイズを返す。 */
export function previewSize(
  large: boolean,
  viewW: number,
  viewH: number,
): { w: number; h: number } {
  if (large) return { w: viewW, h: viewH };
  return { w: PREVIEW_SMALL_W, h: PREVIEW_SMALL_H };
}
