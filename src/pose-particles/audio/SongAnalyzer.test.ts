import { describe, expect, test } from "bun:test";
import { framesFromBins, type BinSample } from "./SongAnalyzer";

const SR = 44100;
const FFT = 2048;

describe("framesFromBins", () => {
  test("空入力なら空配列を返す", () => {
    expect(framesFromBins([], SR, FFT)).toEqual([]);
  });

  test("各 BinSample から 1 個の BandFrame が出る (時刻も写される)", () => {
    const bins = new Uint8Array(FFT / 2);
    const samples: BinSample[] = [
      { t: 0.0, bins },
      { t: 0.05, bins },
      { t: 0.10, bins },
    ];
    const frames = framesFromBins(samples, SR, FFT);
    expect(frames).toHaveLength(3);
    expect(frames[0]?.t).toBeCloseTo(0.0, 3);
    expect(frames[1]?.t).toBeCloseTo(0.05, 3);
  });

  test("bass-only の bin (60-250Hz 帯のみ高い) で bass > mid, treble", () => {
    const bins = new Uint8Array(FFT / 2);
    const lo = Math.floor((60 / (SR / 2)) * (FFT / 2));
    const hi = Math.floor((250 / (SR / 2)) * (FFT / 2));
    for (let i = lo; i <= hi; i++) bins[i] = 255;
    const f = framesFromBins([{ t: 0, bins }], SR, FFT)[0]!;
    expect(f.bass).toBeGreaterThan(0.9);
    expect(f.mid).toBeLessThan(0.1);
    expect(f.treble).toBeLessThan(0.1);
  });

  test("無音 (全 bin = 0) で全帯域 0", () => {
    const bins = new Uint8Array(FFT / 2);
    const f = framesFromBins([{ t: 0, bins }], SR, FFT)[0]!;
    expect(f.volume).toBe(0);
    expect(f.bass).toBe(0);
    expect(f.mid).toBe(0);
    expect(f.treble).toBe(0);
  });
});
