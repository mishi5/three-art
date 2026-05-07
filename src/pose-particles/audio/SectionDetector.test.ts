import { describe, expect, test } from "bun:test";
import type { BandTimeSeries } from "../automation/AnalysisCache";
import { detect, recomputeSections, type DetectorOptions } from "./SectionDetector";

const HOP_MS = 50;

function makeSeries(blocks: Array<{ duration: number; bass: number; mid: number; treble: number; volume?: number }>): BandTimeSeries {
  const frames = [];
  let t = 0;
  for (const b of blocks) {
    const n = Math.round((b.duration * 1000) / HOP_MS);
    for (let i = 0; i < n; i++) {
      frames.push({ t, volume: b.volume ?? Math.max(b.bass, b.mid, b.treble), bass: b.bass, mid: b.mid, treble: b.treble });
      t += HOP_MS / 1000;
    }
  }
  return { duration: t, frames, sampleRate: 44100 };
}

// Threshold は SMOOTH_WINDOW=20 で step transition の novelty が ~0.024 に
// 平滑化される前提で 0.02 に設定。実音源用デフォルトは settings.ts 側で別。
const OPTS: DetectorOptions = { noveltyThreshold: 0.02, minSectionSec: 1.0 };

describe("SectionDetector.detect", () => {
  test("単一帯域だけが鳴る曲は境界 0 個 = セクション 1 個", () => {
    const series = makeSeries([{ duration: 30, bass: 0.8, mid: 0, treble: 0 }]);
    const r = detect(series, OPTS);
    expect(r.boundaries).toHaveLength(0);
    expect(r.sections).toHaveLength(1);
    expect(r.sections[0]?.start).toBe(0);
    expect(r.sections[0]?.end).toBeCloseTo(series.duration, 1);
  });

  test("形状変化 (bass-only → treble-only) で中央付近に境界が立つ", () => {
    const series = makeSeries([
      { duration: 15, bass: 0.9, mid: 0, treble: 0 },
      { duration: 15, bass: 0,   mid: 0, treble: 0.9 },
    ]);
    const r = detect(series, OPTS);
    expect(r.boundaries.length).toBeGreaterThanOrEqual(1);
    const closest = r.boundaries.reduce((p, b) => Math.abs(b.t - 15) < Math.abs(p.t - 15) ? b : p);
    expect(Math.abs(closest.t - 15)).toBeLessThan(2.0);
    expect(closest.source).toBe("auto");
  });

  test("noveltyThreshold を上げると境界数が減る (または同じ)", () => {
    const series = makeSeries([
      { duration: 5, bass: 0.9, mid: 0, treble: 0 },
      { duration: 5, bass: 0,   mid: 0.9, treble: 0 },
      { duration: 5, bass: 0,   mid: 0, treble: 0.9 },
      { duration: 5, bass: 0.9, mid: 0, treble: 0 },
    ]);
    const lo = detect(series, { ...OPTS, noveltyThreshold: 0.01 }).boundaries.length;
    const hi = detect(series, { ...OPTS, noveltyThreshold: 0.5 }).boundaries.length;
    expect(hi).toBeLessThanOrEqual(lo);
  });

  test("minSectionSec で過剰検出が抑制される", () => {
    const blocks = [];
    for (let i = 0; i < 30; i++) {
      blocks.push({
        duration: 1,
        bass: i % 3 === 0 ? 0.9 : 0,
        mid: i % 3 === 1 ? 0.9 : 0,
        treble: i % 3 === 2 ? 0.9 : 0,
      });
    }
    const series = makeSeries(blocks);
    const r = detect(series, { noveltyThreshold: 0.01, minSectionSec: 5 });
    expect(r.boundaries.length).toBeLessThanOrEqual(6);
  });

  test("打楽器 transient (silence→spike→silence) は境界として検出されない", () => {
    // 30 秒, 0.5s ごとに 1 frame だけ kick (前後は silence)。
    // cosine novelty は片側 zero-vec で 0 を返すため、kick frame の novelty も 0。
    const blocks: Array<{ duration: number; bass: number; mid: number; treble: number; volume?: number }> = [];
    for (let i = 0; i < 60; i++) {
      blocks.push({ duration: 0.05, bass: 0.6, mid: 0.4, treble: 0.2 }); // kick
      blocks.push({ duration: 0.45, bass: 0,   mid: 0,   treble: 0   }); // silence
    }
    const series = makeSeries(blocks);
    const r = detect(series, { noveltyThreshold: 0.02, minSectionSec: 4.0 });
    expect(r.boundaries.length).toBeLessThanOrEqual(1);
  });

  test("セクションの bassAbs / midAbs / trebleAbs はセクション内平均 (生値)", () => {
    const series = makeSeries([{ duration: 30, bass: 0.4, mid: 0.5, treble: 0.6 }]);
    const r = detect(series, OPTS);
    expect(r.sections[0]?.bassAbs).toBeCloseTo(0.4, 2);
    expect(r.sections[0]?.midAbs).toBeCloseTo(0.5, 2);
    expect(r.sections[0]?.trebleAbs).toBeCloseTo(0.6, 2);
  });

  test("曲全体が一定エネルギーなら energyNorm は 0.5 にフォールバック", () => {
    const series = makeSeries([{ duration: 30, bass: 0.5, mid: 0.5, treble: 0.5, volume: 0.5 }]);
    const r = detect(series, OPTS);
    expect(r.sections[0]?.energyNorm).toBeCloseTo(0.5, 2);
  });
});

describe("SectionDetector.recomputeSections", () => {
  test("ユーザが追加した境界に対してセクション特徴量を再計算する", () => {
    const series = makeSeries([
      { duration: 10, bass: 0.2, mid: 0.2, treble: 0.2, volume: 0.2 },
      { duration: 10, bass: 0.8, mid: 0.8, treble: 0.8, volume: 0.8 },
    ]);
    const sections = recomputeSections(series, [{ t: 10, source: "user-add" }]);
    expect(sections).toHaveLength(2);
    expect(sections[0]?.bassAbs).toBeCloseTo(0.2, 2);
    expect(sections[1]?.bassAbs).toBeCloseTo(0.8, 2);
  });

  test("境界 0 個なら曲全体を覆う 1 セクション", () => {
    const series = makeSeries([{ duration: 10, bass: 0.5, mid: 0.5, treble: 0.5 }]);
    const sections = recomputeSections(series, []);
    expect(sections).toHaveLength(1);
    expect(sections[0]?.start).toBe(0);
    expect(sections[0]?.end).toBeCloseTo(series.duration, 1);
  });

  test("amp-only シフト (形状不変) は detect では境界が立たないが、recomputeSections で energyNorm が min-max 正規化される", () => {
    // 同じ帯域比 (1:1:1) で振幅だけが変わる。cosine novelty は形状のみ捉えるので
    // detect は境界 0 を返す。energyNorm の min-max 正規化機能はユーザが
    // SectionTimeline で境界を追加した経路でのみ意味を持つので、recomputeSections で検証。
    const series = makeSeries([
      { duration: 10, bass: 0.2, mid: 0.2, treble: 0.2, volume: 0.2 },
      { duration: 10, bass: 0.8, mid: 0.8, treble: 0.8, volume: 0.8 },
    ]);
    expect(detect(series, OPTS).boundaries).toHaveLength(0);
    const sections = recomputeSections(series, [{ t: 10, source: "user-add" }]);
    const energies = sections.map((s) => s.energyNorm).sort((a, b) => a - b);
    expect(energies[0]).toBeCloseTo(0, 1);
    expect(energies[energies.length - 1]).toBeCloseTo(1, 1);
  });
});
