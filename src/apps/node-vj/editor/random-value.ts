// #150: ランダムボタン用の純粋ロジック。

/**
 * [min, max] を rand(0..1) で線形補間したランダム値。
 * min>max は入れ替えて扱う。rand=0→min, rand=1→max。
 */
export function randomInRange(min: number, max: number, rand: number): number {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  return lo + (hi - lo) * rand;
}
