import type { BandFrame, BandTimeSeries, Section, SectionBoundary } from "../automation/AnalysisCache";
export type { BandFrame, BandTimeSeries, Section, SectionBoundary };

export interface DetectorOptions {
  noveltyThreshold: number;
  minSectionSec: number;
}

const SMOOTH_WINDOW = 5; // 5 frames * 50ms = 250ms

/**
 * 帯域 3 軸 [bass, mid, treble] の L2 距離を sqrt(3) で正規化。値域 [0, 1]。
 * スペクトル形状と振幅の両方の変化を捉える。
 */
function l2Novelty(a: BandFrame, b: BandFrame): number {
  const db = b.bass - a.bass;
  const dm = b.mid - a.mid;
  const dt = b.treble - a.treble;
  return Math.sqrt(db * db + dm * dm + dt * dt) / Math.sqrt(3);
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
  for (let i = 1; i < frames.length; i++) {
    novelty[i] = l2Novelty(frames[i - 1]!, frames[i]!);
  }
  const smoothed = smooth(novelty, SMOOTH_WINDOW);
  const peakIdx = findPeaks(smoothed, opts.noveltyThreshold);
  const peakTs = peakIdx.map((i) => frames[i]!.t);
  const merged = mergeNearby(peakTs, opts.minSectionSec);

  const boundaries: SectionBoundary[] = merged
    .filter((t) => t > opts.minSectionSec / 2 && t < series.duration - opts.minSectionSec / 2)
    .map((t) => ({ t, source: "auto" }));

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
