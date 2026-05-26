import { describe, it, expect, beforeEach } from "bun:test";
import {
  loadExcludedPaths,
  saveExcludedPaths,
  SAFE_EXCLUDED_STORAGE_KEY,
} from "./safe-randomize-storage";
import { DEFAULT_SAFE_EXCLUDED } from "./randomize";

type MemStorage = {
  store: Record<string, string>;
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
};

function makeStubStorage(): MemStorage {
  return {
    store: {},
    getItem(k) {
      return this.store[k] ?? null;
    },
    setItem(k, v) {
      this.store[k] = v;
    },
    removeItem(k) {
      delete this.store[k];
    },
  };
}

beforeEach(() => {
  (globalThis as unknown as { localStorage?: MemStorage }).localStorage = makeStubStorage();
});

describe("safe-randomize-storage (Issue #46)", () => {
  it("未保存時は DEFAULT_SAFE_EXCLUDED を返す", () => {
    const loaded = loadExcludedPaths();
    expect(loaded).toBeInstanceOf(Set);
    expect(loaded.size).toBe(DEFAULT_SAFE_EXCLUDED.length);
    for (const p of DEFAULT_SAFE_EXCLUDED) expect(loaded.has(p)).toBe(true);
  });

  it("save → load で集合がそのまま復元される", () => {
    const original = new Set(["color.hueBase", "twist.enabled", "rain.count"]);
    saveExcludedPaths(original);
    const loaded = loadExcludedPaths();
    expect(loaded).toEqual(original);
  });

  it("空集合を save → load しても空集合のまま (DEFAULT には戻らない)", () => {
    saveExcludedPaths(new Set());
    const loaded = loadExcludedPaths();
    expect(loaded.size).toBe(0);
  });

  it("不正 JSON が入っている場合は DEFAULT にフォールバック", () => {
    const ls = (globalThis as unknown as { localStorage: MemStorage }).localStorage;
    ls.setItem(SAFE_EXCLUDED_STORAGE_KEY, "<<not json>>");
    const loaded = loadExcludedPaths();
    expect(loaded.size).toBe(DEFAULT_SAFE_EXCLUDED.length);
    for (const p of DEFAULT_SAFE_EXCLUDED) expect(loaded.has(p)).toBe(true);
  });

  it("配列以外 (object) が入っている場合は DEFAULT にフォールバック", () => {
    const ls = (globalThis as unknown as { localStorage: MemStorage }).localStorage;
    ls.setItem(SAFE_EXCLUDED_STORAGE_KEY, JSON.stringify({ foo: 1 }));
    const loaded = loadExcludedPaths();
    expect(loaded.size).toBe(DEFAULT_SAFE_EXCLUDED.length);
  });

  it("文字列でない要素を含む配列は DEFAULT にフォールバック", () => {
    const ls = (globalThis as unknown as { localStorage: MemStorage }).localStorage;
    ls.setItem(SAFE_EXCLUDED_STORAGE_KEY, JSON.stringify(["color.hueBase", 42]));
    const loaded = loadExcludedPaths();
    expect(loaded.size).toBe(DEFAULT_SAFE_EXCLUDED.length);
  });

  it("descriptor に未登録の path も保存・復元できる (将来の path 削除に頑健)", () => {
    const set = new Set(["color.hueBase", "obsolete.path.example"]);
    saveExcludedPaths(set);
    const loaded = loadExcludedPaths();
    expect(loaded.has("color.hueBase")).toBe(true);
    expect(loaded.has("obsolete.path.example")).toBe(true);
  });

  it("save は localStorage に JSON 配列として書き込む", () => {
    saveExcludedPaths(new Set(["a", "b"]));
    const ls = (globalThis as unknown as { localStorage: MemStorage }).localStorage;
    const raw = ls.getItem(SAFE_EXCLUDED_STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw as string);
    expect(Array.isArray(parsed)).toBe(true);
    expect(new Set(parsed)).toEqual(new Set(["a", "b"]));
  });
});
