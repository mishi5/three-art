import { describe, it, expect, beforeEach } from "bun:test";
import { localStorageAdapter, PRESETS_STORAGE_KEY } from "./storage";
import { makeDefaultSettings } from "../settings";
import type { PresetBundle } from "./types";

/**
 * グローバル localStorage が無い環境のために最小のスタブを用意する。
 * 各テストで初期化する。
 */
type MemStorage = {
  store: Record<string, string>;
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
};

function makeStubStorage(throwQuota = false): MemStorage {
  const s: MemStorage = {
    store: {},
    getItem(k) { return this.store[k] ?? null; },
    setItem(k, v) {
      if (throwQuota) {
        const e = new Error("QuotaExceededError");
        e.name = "QuotaExceededError";
        throw e;
      }
      this.store[k] = v;
    },
    removeItem(k) { delete this.store[k]; },
  };
  return s;
}

describe("localStorageAdapter", () => {
  beforeEach(() => {
    // テストごとに独立した globalThis.localStorage を差し替え
    (globalThis as unknown as { localStorage?: MemStorage }).localStorage = makeStubStorage();
  });

  it("read() returns empty bundle when storage is empty", () => {
    const a = localStorageAdapter();
    expect(a.read()).toEqual({ version: 1, presets: [] });
  });

  it("read() returns empty bundle when stored JSON is invalid", () => {
    (globalThis as unknown as { localStorage: MemStorage }).localStorage.setItem(
      PRESETS_STORAGE_KEY,
      "<<not json>>",
    );
    const a = localStorageAdapter();
    expect(a.read()).toEqual({ version: 1, presets: [] });
  });

  it("write() then read() round-trips a bundle", () => {
    const a = localStorageAdapter();
    const b: PresetBundle = {
      version: 1,
      presets: [{
        id: "x", name: "n", description: "d", thumbnail: "t",
        settings: makeDefaultSettings(), createdAt: 1, updatedAt: 1,
      }],
    };
    a.write(b);
    expect(a.read()).toEqual(b);
  });

  it("write() rethrows QuotaExceededError so the caller can show a UI message", () => {
    (globalThis as unknown as { localStorage?: MemStorage }).localStorage = makeStubStorage(true);
    const a = localStorageAdapter();
    expect(() => a.write({ version: 1, presets: [] })).toThrow();
  });

  it("works with a missing globalThis.localStorage (test-runner environment)", () => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
    const a = localStorageAdapter();
    // localStorage が存在しない環境では空 Bundle を返し、write は no-op で済ます
    expect(a.read()).toEqual({ version: 1, presets: [] });
    expect(() => a.write({ version: 1, presets: [] })).not.toThrow();
  });
});
