// #282: コーナーピンワープの数理（純関数・THREE/DOM 非依存）。
// 座標系は「出力表示空間」（x 右・y 下・(0,0)=出力フレーム左上・(1,1)=右下）で統一する。
// Screen ノードの 4 隅 param は「ソースの単位正方形の各隅が出力表示空間のどこへ写るか」の
// 正規化座標。テクスチャの v 反転（GL は y 上向き）はシェーダ側で吸収する。

export interface WarpPoint { x: number; y: number }

/** 4 隅（tl=左上・tr=右上・bl=左下・br=右下）。 */
export interface Corners { tl: WarpPoint; tr: WarpPoint; bl: WarpPoint; br: WarpPoint }

/** 3×3 行列（row-major: [m00,m01,m02, m10,m11,m12, m20,m21,m22]）。 */
export type Mat3 = readonly number[];

/** 恒等行列。 */
export const IDENTITY_MAT3: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** ワープなしの既定 4 隅。 */
export const DEFAULT_CORNERS: Corners = {
  tl: { x: 0, y: 0 }, tr: { x: 1, y: 0 }, bl: { x: 0, y: 1 }, br: { x: 1, y: 1 },
};

/** 4 隅 param の可動範囲（ParamDef の min/max と一致させる）。 */
export const WARP_MIN = -0.5;
export const WARP_MAX = 1.5;

/** Screen ノードの 4 隅 param id（4 隅 × xy・この順で定義する）。 */
export const WARP_PARAM_IDS = ["tlX", "tlY", "trX", "trY", "blX", "blY", "brX", "brY"] as const;
export type WarpParamId = (typeof WARP_PARAM_IDS)[number];

/** 隅名。 */
export type CornerKey = "tl" | "tr" | "bl" | "br";

/** 隅名 → param id ペア（postMessage の corner から params を引く用）。 */
export function cornerParamIds(corner: CornerKey): { x: WarpParamId; y: WarpParamId } {
  return { x: `${corner}X` as WarpParamId, y: `${corner}Y` as WarpParamId };
}

/** 射影変換を点に適用する（同次座標で除算）。 */
export function applyHomography(m: Mat3, p: WarpPoint): WarpPoint {
  const w = m[6]! * p.x + m[7]! * p.y + m[8]!;
  return {
    x: (m[0]! * p.x + m[1]! * p.y + m[2]!) / w,
    y: (m[3]! * p.x + m[4]! * p.y + m[5]!) / w,
  };
}

/** 3×3 行列式。 */
function det3(m: Mat3): number {
  return (
    m[0]! * (m[4]! * m[8]! - m[5]! * m[7]!) -
    m[1]! * (m[3]! * m[8]! - m[5]! * m[6]!) +
    m[2]! * (m[3]! * m[7]! - m[4]! * m[6]!)
  );
}

/** 余因子行列による逆行列（det 退化は null）。 */
function invert3(m: Mat3): Mat3 | null {
  const d = det3(m);
  if (!Number.isFinite(d) || Math.abs(d) < 1e-12) return null;
  return [
    (m[4]! * m[8]! - m[5]! * m[7]!) / d,
    (m[2]! * m[7]! - m[1]! * m[8]!) / d,
    (m[1]! * m[5]! - m[2]! * m[4]!) / d,
    (m[5]! * m[6]! - m[3]! * m[8]!) / d,
    (m[0]! * m[8]! - m[2]! * m[6]!) / d,
    (m[2]! * m[3]! - m[0]! * m[5]!) / d,
    (m[3]! * m[7]! - m[4]! * m[6]!) / d,
    (m[1]! * m[6]! - m[0]! * m[7]!) / d,
    (m[0]! * m[4]! - m[1]! * m[3]!) / d,
  ];
}

/**
 * 単位正方形 (0,0)-(1,1) → 4 隅への 3×3 射影変換（Heckbert の square-to-quad 閉形式）と
 * その逆行列を求める。退化ケース（非有限値・3 点同一直線・面積ゼロ等で行列が特異）は
 * forward/inverse とも恒等にフォールバックする（例外を投げない）。
 */
export function homographyFromCorners(c: Corners): { forward: Mat3; inverse: Mat3 } {
  const pts = [c.tl, c.tr, c.br, c.bl]; // p0=(0,0), p1=(1,0), p2=(1,1), p3=(0,1) の順
  if (pts.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) {
    return { forward: IDENTITY_MAT3, inverse: IDENTITY_MAT3 };
  }
  const [p0, p1, p2, p3] = pts as [WarpPoint, WarpPoint, WarpPoint, WarpPoint];
  const sx = p0.x - p1.x + p2.x - p3.x;
  const sy = p0.y - p1.y + p2.y - p3.y;
  let forward: Mat3;
  if (sx === 0 && sy === 0) {
    // アフィン（射影項なし）
    forward = [
      p1.x - p0.x, p3.x - p0.x, p0.x,
      p1.y - p0.y, p3.y - p0.y, p0.y,
      0, 0, 1,
    ];
  } else {
    const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x;
    const dy1 = p1.y - p2.y, dy2 = p3.y - p2.y;
    const det = dx1 * dy2 - dx2 * dy1;
    if (!Number.isFinite(det) || Math.abs(det) < 1e-12) {
      return { forward: IDENTITY_MAT3, inverse: IDENTITY_MAT3 };
    }
    const g = (sx * dy2 - sy * dx2) / det;
    const h = (dx1 * sy - dy1 * sx) / det;
    forward = [
      p1.x - p0.x + g * p1.x, p3.x - p0.x + h * p3.x, p0.x,
      p1.y - p0.y + g * p1.y, p3.y - p0.y + h * p3.y, p0.y,
      g, h, 1,
    ];
  }
  const inverse = invert3(forward);
  if (!inverse || [...forward, ...inverse].some((v) => !Number.isFinite(v))) {
    return { forward: IDENTITY_MAT3, inverse: IDENTITY_MAT3 };
  }
  return { forward, inverse };
}

/** 有限数なら値を、そうでなければ fallback を返す。 */
function finiteOr(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/**
 * Screen params（8 個の number・WARP_PARAM_IDS）→ Corners。
 * 非有限・欠落・非数値は既定値（DEFAULT_CORNERS）へフォールバックする。
 */
export function sanitizeCorners(params: Record<string, unknown> | undefined): Corners {
  const p = params ?? {};
  const d = DEFAULT_CORNERS;
  return {
    tl: { x: finiteOr(p.tlX, d.tl.x), y: finiteOr(p.tlY, d.tl.y) },
    tr: { x: finiteOr(p.trX, d.tr.x), y: finiteOr(p.trY, d.tr.y) },
    bl: { x: finiteOr(p.blX, d.bl.x), y: finiteOr(p.blY, d.bl.y) },
    br: { x: finiteOr(p.brX, d.br.x), y: finiteOr(p.brY, d.br.y) },
  };
}

/** contain 後の実表示矩形（editor/fit.ts の FitRect と同型）。 */
export interface WarpRect { x: number; y: number; w: number; h: number }

/** 正規化コーナー → 表示矩形内のピクセル座標（出力ウィンドウのハンドル配置用）。 */
export function handlePoint(corner: WarpPoint, rect: WarpRect): WarpPoint {
  return { x: rect.x + corner.x * rect.w, y: rect.y + corner.y * rect.h };
}

/**
 * ピクセル座標 → 正規化コーナー（handlePoint の逆変換・ドラッグ用）。
 * param の min/max（WARP_MIN..WARP_MAX）へクランプする。矩形が不正（w/h<=0）なら (0,0)。
 */
export function normalizedPoint(px: number, py: number, rect: WarpRect): WarpPoint {
  if (!(rect.w > 0) || !(rect.h > 0)) return { x: 0, y: 0 };
  const clamp = (v: number): number => Math.max(WARP_MIN, Math.min(WARP_MAX, v));
  return { x: clamp((px - rect.x) / rect.w), y: clamp((py - rect.y) / rect.h) };
}
