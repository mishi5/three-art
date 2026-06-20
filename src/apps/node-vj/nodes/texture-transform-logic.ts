// #138: テクスチャ Transform（2D UV 変換）の純ロジック。
// シェーダ（TextureTransformNode の FRAG）と同じ式を JS でも持ち、TDD する。
// 出力画素の UV から「どこをサンプルするか」を返す逆変換。

export type WrapMode = "clamp" | "repeat" | "mirror" | "none";

export interface TexTransformParams {
  /** 画像の平行移動（UV 単位、+で右/下へ移動）。 */
  offsetX: number;
  offsetY: number;
  /** 拡大率（>1 でズームイン）。 */
  scaleX: number;
  scaleY: number;
  /** 回転（ラジアン、中心まわり）。 */
  rotation: number;
  flipX: boolean;
  flipY: boolean;
  wrap: WrapMode;
}

/**
 * 出力画素 UV (u,v) からサンプル元 UV を求める（wrap 前）。中心 0.5 まわりで
 * 回転（aspect 補正つき）→ 拡縮 → 反転し、最後に offset で平行移動する。
 */
export function transformUV(
  u: number,
  v: number,
  p: TexTransformParams,
  aspect: number,
): { u: number; v: number } {
  let px = (u - 0.5) * aspect;
  let py = v - 0.5;
  // 中心まわりの逆回転
  const ca = Math.cos(-p.rotation);
  const sa = Math.sin(-p.rotation);
  const rx = ca * px - sa * py;
  const ry = sa * px + ca * py;
  px = rx / aspect;
  py = ry;
  // 拡縮（>1 でズームイン）
  px /= p.scaleX;
  py /= p.scaleY;
  // 反転
  if (p.flipX) px = -px;
  if (p.flipY) py = -py;
  // 中心へ戻し、画像移動分を引く
  return { u: px + 0.5 - p.offsetX, v: py + 0.5 - p.offsetY };
}

/** 1 座標を wrap モードで [0,1] に写す。"none" は写さずそのまま返す（可視判定は isOutOfBounds）。 */
export function wrapCoord(x: number, mode: WrapMode): number {
  if (mode === "repeat") return x - Math.floor(x);
  if (mode === "mirror") {
    const m = Math.abs(x) % 2;
    return m > 1 ? 2 - m : m;
  }
  if (mode === "none") return x;
  return Math.min(1, Math.max(0, x)); // clamp
}

/** "none"（描画しない）用: サンプル UV が [0,1] の範囲外か。範囲外なら透明にする。 */
export function isOutOfBounds(u: number, v: number): boolean {
  return u < 0 || u > 1 || v < 0 || v > 1;
}

/** transformUV → wrap を合成した最終サンプル UV。 */
export function sampleUV(
  u: number,
  v: number,
  p: TexTransformParams,
  aspect: number,
): { u: number; v: number } {
  const t = transformUV(u, v, p, aspect);
  return { u: wrapCoord(t.u, p.wrap), v: wrapCoord(t.v, p.wrap) };
}
