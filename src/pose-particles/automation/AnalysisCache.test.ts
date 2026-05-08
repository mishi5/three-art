import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { AnalysisCache, CACHE_VERSION, type CachePayload } from "./AnalysisCache";

// localStorage の最小モック (Bun はデフォルトで持たない)
class MemStorage {
  private map = new Map<string, string>();
  getItem(k: string): string | null { return this.map.get(k) ?? null; }
  setItem(k: string, v: string): void { this.map.set(k, v); }
  removeItem(k: string): void { this.map.delete(k); }
  clear(): void { this.map.clear(); }
  get length(): number { return this.map.size; }
  key(): string | null { return null; }
}

const sample = (): CachePayload => ({
  version: CACHE_VERSION,
  series: { duration: 0, frames: [], sampleRate: 44100 },
  boundaries: [],
  sections: [],
});

let storage: MemStorage;

beforeEach(() => {
  storage = new MemStorage();
  (globalThis as unknown as { localStorage: MemStorage }).localStorage = storage;
});

afterEach(() => {
  storage.clear();
});

describe("AnalysisCache", () => {
  test("set した payload を get で取得できる", () => {
    const p = sample();
    AnalysisCache.set("hash1", p);
    expect(AnalysisCache.get("hash1")).toEqual(p);
  });

  test("未登録キーは null", () => {
    expect(AnalysisCache.get("nope")).toBeNull();
  });

  test("version 不一致は null になる", () => {
    storage.setItem(
      "pose-particles.analysis.v1.hash2",
      JSON.stringify({ ...sample(), version: 999 }),
    );
    expect(AnalysisCache.get("hash2")).toBeNull();
  });

  test("壊れた JSON は null になる (例外で落ちない)", () => {
    storage.setItem("pose-particles.analysis.v1.hash3", "not json");
    expect(AnalysisCache.get("hash3")).toBeNull();
  });

  test("set が quota 超過で落ちても例外を漏らさない", () => {
    storage.setItem = () => { throw new Error("QuotaExceededError"); };
    expect(() => AnalysisCache.set("hash4", sample())).not.toThrow();
  });

  test("clear で個別キーが消える", () => {
    AnalysisCache.set("hash5", sample());
    AnalysisCache.clear("hash5");
    expect(AnalysisCache.get("hash5")).toBeNull();
  });
});
