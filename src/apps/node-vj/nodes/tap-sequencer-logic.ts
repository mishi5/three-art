// #204: TapSequencer（スペースキー手打ちシーケンサ）の純粋ロジック。
// 録音の確定（タップ列＋ループ長）と、再生中の「前フレーム→今フレームの間に発火すべきか」判定。
// DOM / 時計に依存しない（時刻はすべて引数の相対秒）。

/** TapSequencer の状態機械フェーズ。idle → recording → playing。 */
export type TapSeqPhase = "idle" | "recording" | "playing";

/**
 * 録音確定。押下時刻列（録音開始からの相対秒）とループ長（＝#275: 'r' キーをホールドしていた時間）を
 * 正規化して返す。タップ 0 回・ループ長 0 以下は null（＝再生しない）。
 * 通常タップは 0..loopLen 内に収まるが、停止と競合した場合に備えて防御的に
 * 負→0・loopLen 以上→wrap（% loopLen）で [0, loopLen) に正規化し、昇順に整列する。
 */
export function finalizeRecording(
  pressTimesSec: readonly number[], loopLenSec: number,
): { taps: number[]; loopLenSec: number } | null {
  if (!Number.isFinite(loopLenSec) || loopLenSec <= 0) return null;
  const taps = pressTimesSec
    .filter((t) => Number.isFinite(t))
    .map((t) => Math.max(0, t) % loopLenSec)
    .sort((a, b) => a - b);
  if (taps.length === 0) return null;
  return { taps, loopLenSec };
}

/**
 * 再生経過秒の半開区間 [prevSec, curSec) に発火すべきタップがあるか。
 * - タップ t（0<=t<loopLen）は t, t+L, t+2L, ... の時刻に発火する（wrap ループ）。
 * - 半開区間なので連続フレーム（[a,b), [b,c)）で二重発火しない。wrap 境界跨ぎも
 *   [p0, L)∪[0, p1) の合併で漏れなく判定する。
 * - dt がループ長以上（コマ落ち等）は「最低 1 回は発火」で true（taps 非空なら必ず 1 周ぶん通過）。
 * - dt<=0・taps 空・loopLen<=0 は false。
 */
export function firedBetween(
  prevSec: number, curSec: number, taps: readonly number[], loopLenSec: number,
): boolean {
  if (!Number.isFinite(prevSec) || !Number.isFinite(curSec)) return false;
  if (!Number.isFinite(loopLenSec) || loopLenSec <= 0 || taps.length === 0) return false;
  const dt = curSec - prevSec;
  if (dt <= 0) return false;
  if (dt >= loopLenSec) return true; // 1 周以上進んだ: 全タップが最低 1 回は該当
  const p0 = wrapMod(prevSec, loopLenSec);
  const p1 = wrapMod(curSec, loopLenSec);
  if (p0 < p1) return taps.some((t) => t >= p0 && t < p1);
  // wrap 跨ぎ（p1 <= p0）: [p0, L) ∪ [0, p1)
  return taps.some((t) => t >= p0 || t < p1);
}

/**
 * x を [0, L) に wrap する。非負の x には % をそのまま使い、負のときだけ L を足す。
 * `((x % L) + L) % L` は非負でも加算で float 誤差が乗り（例: (1.95 % 2 + 2) % 2 → 1.9500000000000002）、
 * タップ時刻との境界比較（半開区間）が崩れるため使わない。
 */
function wrapMod(x: number, L: number): number {
  const m = x % L;
  return m < 0 ? m + L : m;
}

/** 再生経過秒 → ループ内位置（0..loopLen）。表示用。loopLen<=0・非有限は 0。 */
export function playPositionSec(elapsedSec: number, loopLenSec: number): number {
  if (!Number.isFinite(elapsedSec) || !Number.isFinite(loopLenSec) || loopLenSec <= 0) return 0;
  return wrapMod(elapsedSec, loopLenSec);
}
