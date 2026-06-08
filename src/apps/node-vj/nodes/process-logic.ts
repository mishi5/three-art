// 処理ノードの純粋ロジック（テスト可能に分離）。

/**
 * 値 v を [inMin,inMax] から [outMin,outMax] へ線形変換する。
 * clamp=true なら出力を [outMin,outMax]（min/max の向きに依らず）に収める。
 * 退化範囲（inMin==inMax）では outMin を返す。
 */
export function remap(
  v: number, inMin: number, inMax: number, outMin: number, outMax: number, clamp: boolean,
): number {
  if (inMax === inMin) return outMin;
  const ratio = (v - inMin) / (inMax - inMin);
  let out = outMin + ratio * (outMax - outMin);
  if (clamp) {
    const lo = Math.min(outMin, outMax);
    const hi = Math.max(outMin, outMax);
    out = Math.max(lo, Math.min(hi, out));
  }
  return out;
}
