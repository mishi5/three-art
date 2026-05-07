import type { BandFrame, BandTimeSeries, Section, SectionBoundary } from "../automation/AnalysisCache";
export type { BandFrame, BandTimeSeries, Section, SectionBoundary };

export interface DetectorOptions {
  noveltyThreshold: number;
  minSectionSec: number;
}

const SMOOTH_WINDOW = 20; // 20 frames * 50ms ≈ 1 秒

/**
 * 帯域 3 軸 [bass, mid, treble] を単位ベクトル化。ノルム 0 の場合は 0 ベクトル。
 */
function unit3(b: number, m: number, t: number): [number, number, number] {
  const n = Math.sqrt(b * b + m * m + t * t);
  if (n < 1e-9) return [0, 0, 0];
  return [b / n, m / n, t / n];
}

/**
 * (1 - cosSimilarity) / 2 を返す。値域 [0, 1]。
 *
 * 形状（スペクトル比）の変化のみ捉える。両ベクトルがゼロ（無音）または
 * どちらか一方がゼロのときは 0 を返し、変化なしと扱う。これは打楽器の
 * 単発 hit (silence → spike → silence) を境界として誤検出しないため。
 *
 * 振幅変化（pure volume swell, 形状不変）は別途 energyNorm が section ごとに
 * 出すので、ユーザは SectionTimeline で必要なら手動で境界を追加できる。
 */
function cosineNovelty(a: [number, number, number], b: [number, number, number]): number {
  const aZero = a[0] === 0 && a[1] === 0 && a[2] === 0;
  const bZero = b[0] === 0 && b[1] === 0 && b[2] === 0;
  if (aZero || bZero) return 0;
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return (1 - dot) / 2;
}

/**
 * 簡易 SMA。i 番目の出力 = 前後 SMOOTH_WINDOW フレームの平均。
 */
function smooth(values: number[], window: number): number[] {
  const out = new Array<number>(values.length).fill(0);
  const half = Math.floor(window / 2);
  for (let i = 0; i < values.length; i++) {
    let sum = 0, n = 0;
    for (let j = -half; j <= half; j++) {
      const k = i + j;
      if (k < 0 || k >= values.length) continue;
      sum += values[k] ?? 0;
      n++;
    }
    out[i] = n > 0 ? sum / n : 0;
  }
  return out;
}

/**
 * 局所最大点で `noveltyThreshold` を超えるフレーム index を返す。
 */
function findPeaks(values: number[], threshold: number): number[] {
  const peaks: number[] = [];
  for (let i = 1; i < values.length - 1; i++) {
    const v = values[i] ?? 0;
    if (v < threshold) continue;
    if (v >= (values[i - 1] ?? 0) && v >= (values[i + 1] ?? 0)) peaks.push(i);
  }
  return peaks;
}

/**
 * 連続境界を minSec 未満で間引く。各クラスタの中央を残す。
 */
function mergeNearby(times: number[], minSec: number): number[] {
  if (times.length === 0) return [];
  const sorted = [...times].sort((a, b) => a - b);
  const out: number[] = [];
  let cluster: number[] = [sorted[0]!];
  for (let i = 1; i < sorted.length; i++) {
    const t = sorted[i]!;
    if (t - cluster[cluster.length - 1]! < minSec) {
      cluster.push(t);
    } else {
      out.push(cluster[Math.floor(cluster.length / 2)]!);
      cluster = [t];
    }
  }
  out.push(cluster[Math.floor(cluster.length / 2)]!);
  return out;
}

function meanField(frames: BandFrame[], field: "volume" | "bass" | "mid" | "treble"): number {
  if (frames.length === 0) return 0;
  let sum = 0;
  for (const f of frames) sum += f[field];
  return sum / frames.length;
}

function frameRangeOfSection(series: BandTimeSeries, start: number, end: number): BandFrame[] {
  return series.frames.filter((f) => f.t >= start && f.t < end);
}

function buildSections(
  series: BandTimeSeries,
  boundaries: SectionBoundary[],
): Section[] {
  const ts = [0, ...boundaries.map((b) => b.t), series.duration];
  const allVolumes = series.frames.map((f) => f.volume);
  const vmin = allVolumes.length === 0 ? 0 : Math.min(...allVolumes);
  const vmax = allVolumes.length === 0 ? 0 : Math.max(...allVolumes);
  const vrange = vmax - vmin;

  const sections: Section[] = [];
  for (let i = 0; i < ts.length - 1; i++) {
    const start = ts[i]!;
    const end = ts[i + 1]!;
    const slice = frameRangeOfSection(series, start, end);
    const vol = meanField(slice, "volume");
    const energyNorm = vrange < 1e-6 ? 0.5 : (vol - vmin) / vrange;
    sections.push({
      start,
      end,
      energyNorm,
      bassAbs: meanField(slice, "bass"),
      midAbs: meanField(slice, "mid"),
      trebleAbs: meanField(slice, "treble"),
    });
  }
  return sections;
}

/**
 * spectral novelty で境界を立て、各セクションの特徴量を計算して返す。
 */
export function detect(series: BandTimeSeries, opts: DetectorOptions): {
  boundaries: SectionBoundary[];
  sections: Section[];
} {
  const frames = series.frames;
  if (frames.length < 2) {
    return { boundaries: [], sections: buildSections(series, []) };
  }

  const novelty = new Array<number>(frames.length).fill(0);
  let prev = unit3(frames[0]!.bass, frames[0]!.mid, frames[0]!.treble);
  for (let i = 1; i < frames.length; i++) {
    const cur = unit3(frames[i]!.bass, frames[i]!.mid, frames[i]!.treble);
    novelty[i] = cosineNovelty(prev, cur);
    prev = cur;
  }
  const smoothed = smooth(novelty, SMOOTH_WINDOW);
  const peakIdx = findPeaks(smoothed, opts.noveltyThreshold);
  const peakTs = peakIdx.map((i) => frames[i]!.t);
  const merged = mergeNearby(peakTs, opts.minSectionSec);

  const boundaries: SectionBoundary[] = merged
    .filter((t) => t > opts.minSectionSec / 2 && t < series.duration - opts.minSectionSec / 2)
    .map((t) => ({ t, source: "auto" }));

  // Tuning aid: 実音源の novelty スケールは曲によって異なる。Console に
  // 統計を出してユーザが noveltyThreshold スライダを合わせる目安にする。
  if (smoothed.length > 0) {
    let max = 0, sum = 0;
    for (const v of smoothed) {
      if (v > max) max = v;
      sum += v;
    }
    const mean = sum / smoothed.length;
    // eslint-disable-next-line no-console
    console.log(
      `[SectionDetector] smoothed novelty: max=${max.toFixed(5)}, ` +
      `mean=${mean.toFixed(5)}, threshold=${opts.noveltyThreshold}, ` +
      `peaks=${peakIdx.length}, boundaries=${boundaries.length}`,
    );
  }

  return {
    boundaries,
    sections: buildSections(series, boundaries),
  };
}

/**
 * 境界編集後のセクション再計算用 (SectionTimeline からの呼び出し)。
 */
export function recomputeSections(
  series: BandTimeSeries,
  boundaries: SectionBoundary[],
): Section[] {
  const sorted = [...boundaries].sort((a, b) => a.t - b.t);
  return buildSections(series, sorted);
}
