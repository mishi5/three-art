// #155: パラメータジェネレータ（Pulse / RandomValue）の純粋ロジック。

/**
 * 一定間隔のパルス。now が lastFire から interval 以上経過していれば発火し、lastFire を now に更新。
 * （取りこぼし時の連続発火はせず、毎回 now 基準でリセットする素直な実装）
 */
export function pulseStep(
  now: number, lastFire: number, interval: number,
): { fired: boolean; lastFire: number } {
  const fired = now - lastFire >= Math.max(1e-4, interval);
  return { fired, lastFire: fired ? now : lastFire };
}

/** 自動再ロールの判定。interval<=0 は自動再ロールなし（trigger 駆動のみ）。 */
export function rerollDue(now: number, lastFire: number, interval: number): boolean {
  return interval > 0 && now - lastFire >= interval;
}

/** [min,max] を rand(0..1) で線形補間（min>max は入替）。 */
export function randomRange(min: number, max: number, rand: number): number {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  return lo + (hi - lo) * rand;
}
