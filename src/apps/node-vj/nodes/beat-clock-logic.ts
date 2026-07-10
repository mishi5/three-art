// #270: BeatClock（BPM ビートクロック）の純粋ロジック。
// tap-sequencer-logic / automation-logic と同じ流儀（DOM/時計非依存・時刻はすべて引数の相対秒。
// 状態機械そのものは BeatClockNode.ts の BeatClockRuntime が持つ）。

/** BPM の妥当域。fold で外れ値をこの範囲（の代表オクターブ）に折り込む。 */
export const BPM_MIN = 50;
export const BPM_MAX = 250;

/**
 * タップ/onset 時刻列の「やり直し」判定ギャップ（秒）。これを超える間隔が来たら
 * それ以前のバッファを捨てる（曲間の無音・タップのやり直しで推定が汚れないように）。
 */
export const GAP_RESET_SEC = 2.5;

// fold の正規化帯: BPM_MIN..BPM_MAX の幾何中心（√(50·250)≈111.8）を中心とする 1 オクターブ
// [中心/√2, 中心·√2) ≈ [79.1, 158.1)。妥当域全体は幅がオクターブ超（比 5 倍）あり、×2/÷2 の
// 折り込み先として一意に定まらない（例: 0.25s 間隔は 240BPM とも 120BPM とも読める）ため、
// 「倍テン/半テン（8分打ち・2拍毎など）は同じテンポとして扱う」要件を満たす一意な代表値と
// してこの帯へ正規化する。
const FOLD_CENTER_BPM = Math.sqrt(BPM_MIN * BPM_MAX);
const FOLD_LO_BPM = FOLD_CENTER_BPM / Math.SQRT2;
const FOLD_HI_BPM = FOLD_CENTER_BPM * Math.SQRT2;

/**
 * 間隔（秒）を BPM 妥当域に対応する区間へ ×2/÷2 で折り込み、折り込み後の間隔（秒）を返す。
 * 倍テン/半テンの onset（8分打ち・2拍毎など）を同じテンポとして扱うため。
 * 折り込みきれない（妥当域から 1 オクターブ超離れた極端に短い/長い）間隔は null
 * （チャタリング・無音区間などの外れ値として棄却）。
 */
export function foldIntervalToBpmRange(intervalSec: number): number | null {
  if (!Number.isFinite(intervalSec) || intervalSec <= 0) return null;
  const rawBpm = 60 / intervalSec;
  if (rawBpm < BPM_MIN / 2 || rawBpm > BPM_MAX * 2) return null;
  let bpm = rawBpm;
  while (bpm >= FOLD_HI_BPM) bpm /= 2;
  while (bpm < FOLD_LO_BPM) bpm *= 2;
  return 60 / bpm;
}

/**
 * 間隔列から BPM を推定する。各間隔を fold → 有効数が minCount 未満なら null →
 * 中央値（偶数個は中央 2 点の平均）→ 60/median。中央値ベースなので単発の外れ値に頑健。
 */
export function estimateBpm(intervalsSec: readonly number[], minCount = 3): number | null {
  const folded: number[] = [];
  for (const iv of intervalsSec) {
    const f = foldIntervalToBpmRange(iv);
    if (f !== null) folded.push(f);
  }
  if (folded.length === 0 || folded.length < minCount) return null;
  folded.sort((a, b) => a - b);
  const mid = folded.length >> 1;
  const median = folded.length % 2 === 1 ? folded[mid]! : (folded[mid - 1]! + folded[mid]!) / 2;
  return 60 / median;
}

/**
 * タップ/onset 時刻列（昇順）→ 隣接間隔列。gapResetSec（default GAP_RESET_SEC）を超える間隔で
 * それ以前を捨てる（曲間の無音・タップのやり直しでバッファが汚れないように）。
 * 同時刻・逆行（dt<=0）や非有限の間隔は防御的にスキップする。
 */
export function recentIntervals(timesSec: readonly number[], gapResetSec = GAP_RESET_SEC): number[] {
  const out: number[] = [];
  for (let i = 1; i < timesSec.length; i++) {
    const dt = timesSec[i]! - timesSec[i - 1]!;
    if (!Number.isFinite(dt)) continue;
    if (dt > gapResetSec) {
      out.length = 0; // ギャップ以前は捨てる（間隔そのものも採用しない）
      continue;
    }
    if (dt > 0) out.push(dt);
  }
  return out;
}

/**
 * 累積 beats の半開区間 (prevBeats, curBeats] が divBeats の倍数境界を跨いだか。
 * floor(cur/div) > floor(prev/div) 判定（半開区間なので連続フレームで二重発火せず、
 * コマ落ちで複数境界を跨いでも 1 回にまとまる）。div<=0・非有限・cur<=prev は false。
 * 初回フレーム（prev=cur=0 相当）は cur<=prev に該当し誤発火しない。
 */
export function crossedDivision(prevBeats: number, curBeats: number, divBeats: number): boolean {
  if (!Number.isFinite(prevBeats) || !Number.isFinite(curBeats) || !Number.isFinite(divBeats)) return false;
  if (divBeats <= 0 || curBeats <= prevBeats) return false;
  return Math.floor(curBeats / divBeats) > Math.floor(prevBeats / divBeats);
}

/** division param の enum 値（"1/4"|"1/2"|"1"|"2"|"4"|"8"）→ 拍数。不正値は 1（毎拍）。 */
export function divisionToBeats(division: unknown): number {
  switch (division) {
    case "1/4": return 0.25;
    case "1/2": return 0.5;
    case "1": return 1;
    case "2": return 2;
    case "4": return 4;
    case "8": return 8;
    default: return 1;
  }
}
