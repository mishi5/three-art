// #92: ワークスペースのズーム用ビューポート変換（純関数）。
// スクリーン座標とワールド座標の関係: screen = world * scale + offset。
// offset はスクリーン px（パン量）、scale は拡大率。NodeEditor がこの関数群を使う。

/** ズーム倍率の下限・上限。 */
export const MIN_SCALE = 0.25;
export const MAX_SCALE = 2.0;

export interface Vec2 {
  x: number;
  y: number;
}

/** scale を [MIN_SCALE, MAX_SCALE] に収める。 */
export function clampScale(scale: number): number {
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
}

/** スクリーン座標 → ワールド座標。world = (screen - offset) / scale。 */
export function screenToWorld(sx: number, sy: number, offset: Vec2, scale: number): Vec2 {
  return { x: (sx - offset.x) / scale, y: (sy - offset.y) / scale };
}

/** ワールド座標 → スクリーン座標。screen = world * scale + offset。 */
export function worldToScreen(wx: number, wy: number, offset: Vec2, scale: number): Vec2 {
  return { x: wx * scale + offset.x, y: wy * scale + offset.y };
}

/**
 * カーソル位置 (sx,sy スクリーン座標) を中心に factor 倍ズームする。
 * カーソル下のワールド点がズーム後も同じスクリーン位置に留まるよう offset を補正する。
 * scale はクランプし、クランプで scale が変わらなくてもカーソル点は保持される。
 */
export function zoomAt(
  sx: number,
  sy: number,
  offset: Vec2,
  scale: number,
  factor: number,
): { offset: Vec2; scale: number } {
  const newScale = clampScale(scale * factor);
  const world = screenToWorld(sx, sy, offset, scale);
  // screen = world * newScale + newOffset を満たす newOffset。
  return {
    scale: newScale,
    offset: { x: sx - world.x * newScale, y: sy - world.y * newScale },
  };
}
