// param 行ドラッグスライダの値計算（純粋関数）。#75
import type { ParamDef } from "../graph/node-type";

const DEFAULT_STEP = 0.1;

function snap(v: number, pd: ParamDef): number {
  const step = pd.step ?? (pd.kind === "int" ? 1 : DEFAULT_STEP);
  let out = Math.round(v / step) * step;
  // 浮動小数の桁ノイズを step の精度で丸める
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
  out = Number(out.toFixed(Math.min(10, decimals + 1)));
  if (pd.kind === "int") out = Math.round(out);
  if (pd.min !== undefined) out = Math.max(pd.min, out);
  if (pd.max !== undefined) out = Math.min(pd.max, out);
  return out;
}

/** min/max を持つ param の「行内 x 位置 → 値」（絶対スライダ）。 */
export function absoluteSliderValue(
  x: number, rowLeft: number, rowWidth: number, pd: ParamDef,
): number {
  const min = pd.min ?? 0;
  const max = pd.max ?? 1;
  const ratio = Math.max(0, Math.min(1, (x - rowLeft) / Math.max(1, rowWidth)));
  return snap(min + ratio * (max - min), pd);
}

/** min/max を持たない param の相対スクラブ（value += dx × step）。 */
export function scrubValue(current: number, dx: number, pd: ParamDef): number {
  const step = pd.step ?? (pd.kind === "int" ? 1 : DEFAULT_STEP);
  return snap(current + dx * step, pd);
}

/** フィルバーの割合 0..1。min/max が揃っていなければ null（バー非表示）。 */
export function fillRatio(value: number, pd: ParamDef): number | null {
  if (pd.min === undefined || pd.max === undefined || pd.max === pd.min) return null;
  return Math.max(0, Math.min(1, (value - pd.min) / (pd.max - pd.min)));
}

/** この param が絶対スライダとして扱えるか（min/max 両方あり）。 */
export function isAbsoluteSlider(pd: ParamDef): boolean {
  return pd.min !== undefined && pd.max !== undefined && pd.max !== pd.min;
}
