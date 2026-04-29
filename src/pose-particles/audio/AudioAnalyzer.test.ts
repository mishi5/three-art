import { describe, expect, it } from "bun:test";
import { computeBands } from "./AudioAnalyzer";

describe("computeBands", () => {
  const sampleRate = 48000;
  const fftSize = 2048;

  it("returns zeros for silence", () => {
    const bins = new Uint8Array(fftSize / 2); // 全部 0
    const r = computeBands(bins, sampleRate, fftSize);
    expect(r.volume).toBe(0);
    expect(r.bass).toBe(0);
    expect(r.mid).toBe(0);
    expect(r.treble).toBe(0);
  });

  it("isolates bass when only low bins are loud", () => {
    const bins = new Uint8Array(fftSize / 2);
    // 60-250Hz 帯域の bin index：~ 2..10 (with sampleRate=48000, fftSize=2048)
    for (let i = 2; i <= 10; i++) bins[i] = 255;
    const r = computeBands(bins, sampleRate, fftSize);
    expect(r.bass).toBeGreaterThan(0.9);
    expect(r.mid).toBe(0);
    expect(r.treble).toBe(0);
  });

  it("isolates treble when only high bins are loud", () => {
    const bins = new Uint8Array(fftSize / 2);
    // 2-8kHz: bin index ~ 85..341
    for (let i = 85; i <= 341; i++) bins[i] = 255;
    const r = computeBands(bins, sampleRate, fftSize);
    expect(r.treble).toBeGreaterThan(0.9);
    expect(r.bass).toBe(0);
  });

  it("volume is the global average", () => {
    const bins = new Uint8Array(fftSize / 2).fill(128);
    const r = computeBands(bins, sampleRate, fftSize);
    expect(r.volume).toBeCloseTo(128 / 255, 2);
  });
});
