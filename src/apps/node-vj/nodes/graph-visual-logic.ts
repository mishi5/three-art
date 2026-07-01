// GraphVisual（#217）の純粋ロジック。
// リングバッファ push と「サンプル列→画面折れ線点列」のマッピングを
// THREE 非依存の純関数に切り出し、テストで厚く検証する。
// 実描画（Canvas2D）は GraphVisualNode / graph-canvas-surface 側で行う。

/** 時刻付きサンプル（timeSec, value）。 */
export interface GraphSample {
  /** ランタイム経過秒。 */
  t: number;
  /** その時刻の値。 */
  v: number;
}

/** 画面座標（Canvas2D ピクセル。原点は左上）。 */
export interface GraphPoint {
  x: number;
  y: number;
}

/** computeGraphPoints に渡すマッピング設定。 */
export interface GraphMapParams {
  /** 横スケール（時間窓・秒）。この幅ぶんを画面幅にマッピングする。 */
  windowSec: number;
  /** 縦スケール下端（画面下端に対応する値）。 */
  yMin: number;
  /** 縦スケール上端（画面上端に対応する値）。 */
  yMax: number;
  /** 現在時刻（この時刻が右端＝最新）。 */
  timeSec: number;
  /** 画面幅（px）。 */
  width: number;
  /** 画面高さ（px）。 */
  height: number;
}

/**
 * リングバッファ上限のサンプル数を算出する（maxWindowSec × fps）。
 * windowSec を最大まで広げても保持できるよう、想定 fps を掛けた上限を返す。
 */
export function graphMaxSamples(maxWindowSec: number, fps: number): number {
  return Math.max(1, Math.ceil(maxWindowSec * fps));
}

/**
 * リングバッファへ 1 サンプル push し、上限超過分を古い方から捨てる（in-place）。
 * 非有限値（NaN/Infinity）は 0 に丸める（未接続や壊れた入力での破綻回避）。
 */
export function pushSample(buf: GraphSample[], t: number, v: number, maxSamples: number): void {
  const value = Number.isFinite(v) ? v : 0;
  buf.push({ t, v: value });
  const limit = Math.max(1, Math.floor(maxSamples));
  const over = buf.length - limit;
  if (over > 0) buf.splice(0, over);
}

/**
 * 値 → Canvas2D の Y 座標。yMax が上端(0)、yMin が下端(height)。
 * 範囲外の値は上下端にクランプする。yMin===yMax の退化時は中央を返す。
 */
export function valueToY(v: number, yMin: number, yMax: number, height: number): number {
  const span = yMax - yMin;
  if (span === 0 || !Number.isFinite(span)) return height / 2;
  const norm = (v - yMin) / span; // yMin→0, yMax→1
  const clamped = Math.max(0, Math.min(1, norm));
  return (1 - clamped) * height; // 上が yMax
}

/**
 * サンプル列 → 画面折れ線点列。右端が最新・左へ流れる（スクロール）。
 * windowSec の外（古すぎ／未来）のサンプルは除外し、Y は範囲外クランプする。
 * サンプルが窓内に無い（空/未接続）場合は空配列を返す。
 */
export function computeGraphPoints(samples: GraphSample[], p: GraphMapParams): GraphPoint[] {
  const win = p.windowSec > 0 ? p.windowSec : 0.0001;
  const pts: GraphPoint[] = [];
  for (const s of samples) {
    const age = p.timeSec - s.t; // 0=最新、正=過去
    if (age < 0 || age > win) continue; // 窓外は描かない
    const x = (1 - age / win) * p.width; // 右端(width)=最新、左端(0)=windowSec 前
    const y = valueToY(s.v, p.yMin, p.yMax, p.height);
    pts.push({ x, y });
  }
  return pts;
}
