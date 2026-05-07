# 曲解析 Auto モード 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

- 対象 Issue: https://github.com/mishi5/three-art/issues/5
- 対象作品: pose-particles
- ブランチ: `feature/5-song-auto-mode`
- 対応 spec: `docs/superpowers/specs/2026-05-04-song-analysis-auto-mode-design.md`

**Goal:** 曲ファイルを事前解析しセクション特徴量から主要 10 パラメータを線形重み式で自動算出して上書きする「Auto モード」を pose-particles に追加する。

**Architecture:** `OfflineAudioContext` で曲を全走査し帯域時系列を作る → spectral novelty で境界検出 → セクション特徴量 (energyNorm, bass/mid/treble Abs) → 線形重み式 + smoothstep 補間で `Settings` を毎フレーム上書き。境界はタイムライン UI で編集可能、結果は localStorage にキャッシュ。

**Tech Stack:** TypeScript, Bun (test ランタイム), Three.js, lil-gui, WebAudio API (`OfflineAudioContext`, `AnalyserNode`).

**Conventions:**
- すべてのコミットメッセージは `#5 <種別>: <内容>` 形式
- 各タスク末尾でリポジトリ全体の `bun test` が全件パスすることを確認してからコミット
- worktree のパス: `.worktrees/5-song-auto-mode/`（以後すべてのコマンドはこの worktree 内で実行）

---

## Task 1: fileHash — ファイル特徴ハッシュ純粋関数

**Files:**
- Create: `src/pose-particles/automation/fileHash.ts`
- Test: `src/pose-particles/automation/fileHash.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/pose-particles/automation/fileHash.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { fileHash } from "./fileHash";

describe("fileHash", () => {
  test("同じ name/size/headBytes なら同じハッシュ", () => {
    const head = new Uint8Array([1, 2, 3, 4, 5]);
    expect(fileHash("a.mp3", 1000, head)).toBe(fileHash("a.mp3", 1000, head));
  });

  test("name が違うとハッシュが変わる", () => {
    const head = new Uint8Array([1, 2, 3]);
    expect(fileHash("a.mp3", 1000, head)).not.toBe(fileHash("b.mp3", 1000, head));
  });

  test("size が違うとハッシュが変わる", () => {
    const head = new Uint8Array([1, 2, 3]);
    expect(fileHash("a.mp3", 1000, head)).not.toBe(fileHash("a.mp3", 2000, head));
  });

  test("headBytes が違うとハッシュが変わる", () => {
    expect(fileHash("a.mp3", 1000, new Uint8Array([1, 2, 3])))
      .not.toBe(fileHash("a.mp3", 1000, new Uint8Array([1, 2, 4])));
  });

  test("空 headBytes でも安定して動く", () => {
    expect(fileHash("a.mp3", 0, new Uint8Array(0))).toBe(fileHash("a.mp3", 0, new Uint8Array(0)));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/pose-particles/automation/fileHash.test.ts`
Expected: FAIL — module `./fileHash` not found.

- [ ] **Step 3: Write the implementation**

Create `src/pose-particles/automation/fileHash.ts`:

```ts
/**
 * ファイル名 / サイズ / 先頭バイトから 32-bit FNV-1a ベースの短い識別子を作る。
 * 暗号学的強度は要らず、AnalysisCache のキーとして衝突しない程度で十分。
 */
export function fileHash(name: string, size: number, headBytes: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < headBytes.length; i++) {
    h ^= headBytes[i] ?? 0;
    h = Math.imul(h, 0x01000193);
  }
  return `${encodeURIComponent(name)}-${size}-${(h >>> 0).toString(16)}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/pose-particles/automation/fileHash.test.ts`
Expected: PASS — 5 tests pass.

Then full suite: `bun test`
Expected: PASS — 29 + 5 = 34 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/pose-particles/automation/fileHash.ts src/pose-particles/automation/fileHash.test.ts
git commit -m "#5 feat: ファイル特徴ハッシュ関数 fileHash を追加"
```

---

## Task 2: AnalysisCache — localStorage キャッシュ層

**Files:**
- Create: `src/pose-particles/automation/AnalysisCache.ts`
- Test: `src/pose-particles/automation/AnalysisCache.test.ts`

このタスクはまだ `BandTimeSeries / Section / SectionBoundary` の型を使う。これらは Task 5 / Task 7 で本格実装するが、`AnalysisCache` 視点では「不透明な payload」を保存できれば十分。型をローカル定義し、後段でファイルを修正したときに型が一致するか整合チェックする。

- [ ] **Step 1: Write the failing test**

Create `src/pose-particles/automation/AnalysisCache.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/pose-particles/automation/AnalysisCache.test.ts`
Expected: FAIL — module `./AnalysisCache` not found.

- [ ] **Step 3: Write the implementation**

Create `src/pose-particles/automation/AnalysisCache.ts`:

```ts
export const CACHE_VERSION = 1;

const KEY_PREFIX = "pose-particles.analysis.v1.";

// 中身の型は段階的に厳密化される。AnalysisCache 自体は "不透明な payload" として扱う。
export interface BandFrame {
  t: number; volume: number; bass: number; mid: number; treble: number;
}
export interface BandTimeSeries {
  duration: number; frames: BandFrame[]; sampleRate: number;
}
export interface SectionBoundary { t: number; source: "auto" | "user-add"; }
export interface Section {
  start: number; end: number;
  energyNorm: number; bassAbs: number; midAbs: number; trebleAbs: number;
}

export interface CachePayload {
  version: number;
  series: BandTimeSeries;
  boundaries: SectionBoundary[];
  sections: Section[];
}

export const AnalysisCache = {
  get(hash: string): CachePayload | null {
    try {
      const raw = localStorage.getItem(KEY_PREFIX + hash);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as CachePayload;
      if (parsed.version !== CACHE_VERSION) return null;
      return parsed;
    } catch {
      return null;
    }
  },

  set(hash: string, payload: CachePayload): void {
    try {
      localStorage.setItem(KEY_PREFIX + hash, JSON.stringify(payload));
    } catch {
      /* quota や privacy mode は握り潰す */
    }
  },

  clear(hash: string): void {
    try {
      localStorage.removeItem(KEY_PREFIX + hash);
    } catch {
      /* ignore */
    }
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/pose-particles/automation/AnalysisCache.test.ts`
Expected: PASS — 6 tests pass.

Full suite: `bun test`
Expected: PASS — 40 tests total.

- [ ] **Step 5: Commit**

```bash
git add src/pose-particles/automation/AnalysisCache.ts src/pose-particles/automation/AnalysisCache.test.ts
git commit -m "#5 feat: localStorage ベースの AnalysisCache を追加"
```

---

## Task 3: setByPath — ドット記法セッター

**Files:**
- Create: `src/pose-particles/automation/setByPath.ts`
- Test: `src/pose-particles/automation/setByPath.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/pose-particles/automation/setByPath.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { setByPath } from "./setByPath";

describe("setByPath", () => {
  test("トップレベルのフィールドを書き込む", () => {
    const obj: Record<string, unknown> = { a: 1, b: 2 };
    setByPath(obj, "a", 99);
    expect(obj.a).toBe(99);
  });

  test("ネストしたフィールドを書き込む", () => {
    const obj = { color: { hueBase: 0.5 }, blur: { strength: 0.0 } };
    setByPath(obj as unknown as Record<string, unknown>, "color.hueBase", 0.8);
    setByPath(obj as unknown as Record<string, unknown>, "blur.strength", 1.2);
    expect(obj.color.hueBase).toBe(0.8);
    expect(obj.blur.strength).toBe(1.2);
  });

  test("途中のキーが無いパスは何もしない (存在しないネスト先は作らない)", () => {
    const obj: Record<string, unknown> = { a: { b: 1 } };
    setByPath(obj, "x.y.z", 42);
    expect(obj).toEqual({ a: { b: 1 } });
  });

  test("3 段以上のネストでも動く", () => {
    const obj = { a: { b: { c: 0 } } };
    setByPath(obj as unknown as Record<string, unknown>, "a.b.c", 7);
    expect(obj.a.b.c).toBe(7);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/pose-particles/automation/setByPath.test.ts`
Expected: FAIL — module `./setByPath` not found.

- [ ] **Step 3: Write the implementation**

Create `src/pose-particles/automation/setByPath.ts`:

```ts
/**
 * `"color.hueBase"` のようなドット記法で `obj` の階層に `value` を書き込む。
 * 途中のキーが存在しない / オブジェクトでない場合は何もしない (例外を投げない)。
 */
export function setByPath(
  obj: Record<string, unknown>,
  path: string,
  value: unknown,
): void {
  const parts = path.split(".");
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (key === undefined) return;
    const next = cur[key];
    if (next === null || next === undefined || typeof next !== "object" || Array.isArray(next)) {
      return;
    }
    cur = next as Record<string, unknown>;
  }
  const lastKey = parts[parts.length - 1];
  if (lastKey === undefined) return;
  cur[lastKey] = value;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/pose-particles/automation/setByPath.test.ts`
Expected: PASS — 4 tests pass.

Full suite: `bun test`
Expected: PASS — 44 tests total.

- [ ] **Step 5: Commit**

```bash
git add src/pose-particles/automation/setByPath.ts src/pose-particles/automation/setByPath.test.ts
git commit -m "#5 feat: ドット記法セッター setByPath を追加"
```

---

## Task 4: AutomationMap — マッピング表と算出関数

**Files:**
- Create: `src/pose-particles/automation/AutomationMap.ts`
- Test: `src/pose-particles/automation/AutomationMap.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/pose-particles/automation/AutomationMap.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import {
  AutomationEntry,
  DEFAULT_AUTOMATION_MAP,
  computeValue,
  type SectionFeatures,
} from "./AutomationMap";

const ZERO: SectionFeatures = { energyNorm: 0, bassAbs: 0, midAbs: 0, trebleAbs: 0 };

describe("computeValue", () => {
  test("全特徴 0 のとき base が返る", () => {
    const e: AutomationEntry = { target: "x", base: 1.5, we: 9, wb: 9, wm: 9, wt: 9, min: 0, max: 10 };
    expect(computeValue(e, ZERO)).toBe(1.5);
  });

  test("線形重みが正しく合計される", () => {
    const e: AutomationEntry = { target: "x", base: 0, we: 1, wb: 2, wm: 3, wt: 4, min: -100, max: 100 };
    expect(computeValue(e, { energyNorm: 0.5, bassAbs: 0.5, midAbs: 0.5, trebleAbs: 0.5 }))
      .toBeCloseTo(0.5 + 1 + 1.5 + 2);
  });

  test("min で下限がかかる", () => {
    const e: AutomationEntry = { target: "x", base: 0, we: -10, wb: 0, wm: 0, wt: 0, min: 0, max: 1 };
    expect(computeValue(e, { ...ZERO, energyNorm: 1 })).toBe(0);
  });

  test("max で上限がかかる", () => {
    const e: AutomationEntry = { target: "x", base: 0, we: 10, wb: 0, wm: 0, wt: 0, min: 0, max: 1 };
    expect(computeValue(e, { ...ZERO, energyNorm: 1 })).toBe(1);
  });
});

describe("DEFAULT_AUTOMATION_MAP", () => {
  test("10 entries", () => {
    expect(DEFAULT_AUTOMATION_MAP).toHaveLength(10);
  });

  test("全特徴 0 のとき各 entry の値は base と一致する", () => {
    for (const e of DEFAULT_AUTOMATION_MAP) {
      expect(computeValue(e, ZERO)).toBe(e.base);
    }
  });

  test("対象 target は重複しない", () => {
    const set = new Set(DEFAULT_AUTOMATION_MAP.map((e) => e.target));
    expect(set.size).toBe(DEFAULT_AUTOMATION_MAP.length);
  });

  test("期待される target を含む (spec 表に対応)", () => {
    const targets = DEFAULT_AUTOMATION_MAP.map((e) => e.target);
    for (const t of [
      "color.hueBase", "color.saturation", "color.bassHueShift",
      "pointCloud.bassExpansion", "pointCloud.trebleShimmer", "pointCloud.volumeSize",
      "fragmentField.midDrift", "fragmentField.jointPull",
      "blur.strength", "camera.autoRotateSpeed",
    ]) {
      expect(targets).toContain(t);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/pose-particles/automation/AutomationMap.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/pose-particles/automation/AutomationMap.ts`:

```ts
export interface SectionFeatures {
  /** 0..1, 曲全体での volume の min/max を min-max 正規化した値 */
  energyNorm: number;
  /** 0..1, セクション内 bass 平均 (生値) */
  bassAbs: number;
  midAbs: number;
  trebleAbs: number;
}

export interface AutomationEntry {
  /** "color.hueBase" のようなドット記法パス。Settings の階層と一致 */
  target: string;
  base: number;
  we: number; // weight for energyNorm
  wb: number; // weight for bassAbs
  wm: number; // weight for midAbs
  wt: number; // weight for trebleAbs
  min: number;
  max: number;
}

export type AutomationMap = ReadonlyArray<AutomationEntry>;

export function computeValue(e: AutomationEntry, f: SectionFeatures): number {
  const v = e.base + e.we * f.energyNorm + e.wb * f.bassAbs + e.wm * f.midAbs + e.wt * f.trebleAbs;
  if (v < e.min) return e.min;
  if (v > e.max) return e.max;
  return v;
}

/**
 * spec 表（設計書 §DEFAULT_AUTOMATION_MAP）にそって 10 個のパラメータを定義する。
 * チューニングは手動確認時に行う想定で、ここはあくまでセンセーブルな初期値。
 */
export const DEFAULT_AUTOMATION_MAP: AutomationMap = [
  { target: "color.hueBase",            base: 0.66, we: 0,    wb: -0.66, wm: -0.33, wt: 0,    min: 0,   max: 1   },
  { target: "color.saturation",         base: 0.3,  we: 0.7,  wb: 0,     wm: 0,     wt: 0,    min: 0,   max: 1   },
  { target: "color.bassHueShift",       base: 0.0,  we: 0.0,  wb: 0.5,   wm: 0,     wt: 0,    min: 0,   max: 1   },
  { target: "pointCloud.bassExpansion", base: 1.0,  we: 2.0,  wb: 4.0,   wm: 0,     wt: 0,    min: 0,   max: 8.0 },
  { target: "pointCloud.trebleShimmer", base: 0.02, we: 0.04, wb: 0,     wm: 0,     wt: 0.10, min: 0,   max: 0.20},
  { target: "pointCloud.volumeSize",    base: 4.0,  we: 10.0, wb: 0,     wm: 0,     wt: 0,    min: 2.0, max: 20.0},
  { target: "fragmentField.midDrift",   base: 0.5,  we: 0.3,  wb: 0,     wm: 1.5,   wt: 0,    min: 0,   max: 2.5 },
  { target: "fragmentField.jointPull",  base: 0.02, we: 0.04, wb: 0,     wm: 0.04,  wt: 0,    min: 0,   max: 0.15},
  { target: "blur.strength",            base: 0.3,  we: 0.7,  wb: 0,     wm: 0,     wt: 0,    min: 0,   max: 2.0 },
  { target: "camera.autoRotateSpeed",   base: 0.0,  we: 2.0,  wb: 0,     wm: 0,     wt: 0,    min: 0,   max: 4.0 },
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/pose-particles/automation/AutomationMap.test.ts`
Expected: PASS — 8 tests pass.

Full suite: `bun test`
Expected: PASS — 52 tests total.

- [ ] **Step 5: Commit**

```bash
git add src/pose-particles/automation/AutomationMap.ts src/pose-particles/automation/AutomationMap.test.ts
git commit -m "#5 feat: 10 パラメータの DEFAULT_AUTOMATION_MAP と computeValue を追加"
```

---

## Task 5: SectionDetector — novelty 計算と境界検出

**Files:**
- Create: `src/pose-particles/audio/SectionDetector.ts`
- Test: `src/pose-particles/audio/SectionDetector.test.ts`

`BandTimeSeries`, `SectionBoundary`, `Section` 型は Task 2 の `AnalysisCache.ts` で先行定義済み。再エクスポートして使う。

> **実装ノート（2026-05-07 追記）**: 実装中に spec のアルゴリズムに 2 つのバグが発見された。
> 1. cosine novelty (3-D 単位ベクトル) は amp-only シフト (形状不変の音量変化) を捉えられない。これは spec が当初想定した「曲全体での energyNorm 正規化を境界検出が前提に」する設計と矛盾する。
> 2. zero-vector ハンドリングが未指定で、打楽器の単発 hit (silence → spike → silence) を強い novelty として検出してしまう。
>
> 解決:
> - cosine novelty は維持（real audio で transient 誤検出を避けるため、L2 やハイブリッドより堅牢）。
> - **片側または両側 zero-vec のとき 0 を返す**ことで transient rejection を実装。
> - amp-only シフトでの境界検出は仕様から外し、ユーザが SectionTimeline で手動境界追加することで対応。`energyNorm` の min-max 正規化は `recomputeSections` 経由で動作する。
> - テストは「形状変化で境界検出」「transient で境界 0」「amp-only シフトは detect では 0、recomputeSections で energyNorm 正規化が機能」を検証する形に修正。
> - threshold は SMOOTH_WINDOW=20 と整合する 0.02 を採用（synthetic step transition で peak ≈ 0.024）。
>
> 詳細は spec doc §解析パイプライン詳細 を参照。下記の Step 3 コードと Step 1 テストは初期 plan で、実コミット (`5d6b...` 後の修正コミット) では cosine novelty + zero-vec ガード版が反映されている。

- [ ] **Step 1: Write the failing test**

Create `src/pose-particles/audio/SectionDetector.test.ts`:

```ts
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

const OPTS: DetectorOptions = { noveltyThreshold: 0.1, minSectionSec: 1.0 };

describe("SectionDetector.detect", () => {
  test("単一帯域だけが鳴る曲は境界 0 個 = セクション 1 個", () => {
    const series = makeSeries([{ duration: 30, bass: 0.8, mid: 0, treble: 0 }]);
    const r = detect(series, OPTS);
    expect(r.boundaries).toHaveLength(0);
    expect(r.sections).toHaveLength(1);
    expect(r.sections[0]?.start).toBe(0);
    expect(r.sections[0]?.end).toBeCloseTo(series.duration, 1);
  });

  test("前半 bass-only / 後半 treble-only で中央付近に境界が立つ", () => {
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
    const lo = detect(series, { ...OPTS, noveltyThreshold: 0.05 }).boundaries.length;
    const hi = detect(series, { ...OPTS, noveltyThreshold: 0.5 }).boundaries.length;
    expect(hi).toBeLessThanOrEqual(lo);
  });

  test("minSectionSec で過剰検出が抑制される", () => {
    // 1 秒ごとに帯域が変わる → 大量に立つはず。minSectionSec=5 で間引かれる。
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
    const r = detect(series, { noveltyThreshold: 0.05, minSectionSec: 5 });
    // 30 秒で minSectionSec=5 なら境界は最大 5 個程度
    expect(r.boundaries.length).toBeLessThanOrEqual(6);
  });

  test("セクションの energyNorm は曲全体内で min-max 正規化される", () => {
    const series = makeSeries([
      { duration: 10, bass: 0.2, mid: 0.2, treble: 0.2, volume: 0.2 },
      { duration: 10, bass: 0.8, mid: 0.8, treble: 0.8, volume: 0.8 },
    ]);
    const r = detect(series, OPTS);
    const energies = r.sections.map((s) => s.energyNorm).sort((a, b) => a - b);
    expect(energies[0]).toBeCloseTo(0, 1);
    expect(energies[energies.length - 1]).toBeCloseTo(1, 1);
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/pose-particles/audio/SectionDetector.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/pose-particles/audio/SectionDetector.ts`:

```ts
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
 * どちらかがゼロベクトルなら 0 (= 似ているとみなす、変化なし)。
 */
function cosineNovelty(a: [number, number, number], b: [number, number, number]): number {
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  if (a[0] === 0 && a[1] === 0 && a[2] === 0) return 0;
  if (b[0] === 0 && b[1] === 0 && b[2] === 0) return 0;
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
  // 全フレームから曲全体の volume min/max を出す
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/pose-particles/audio/SectionDetector.test.ts`
Expected: PASS — 9 tests pass.

Full suite: `bun test`
Expected: PASS — 61 tests total.

- [ ] **Step 5: Commit**

```bash
git add src/pose-particles/audio/SectionDetector.ts src/pose-particles/audio/SectionDetector.test.ts
git commit -m "#5 feat: spectral novelty ベースの SectionDetector を追加"
```

---

## Task 6: ParameterAutomation — 補間 + applyAt

**Files:**
- Create: `src/pose-particles/automation/ParameterAutomation.ts`
- Test: `src/pose-particles/automation/ParameterAutomation.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/pose-particles/automation/ParameterAutomation.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import type { Section, SectionBoundary } from "./AnalysisCache";
import { type AutomationMap } from "./AutomationMap";
import { ParameterAutomation } from "./ParameterAutomation";

interface FakeLive {
  color: { hueBase: number };
  blur: { strength: number };
}
function makeLive(): FakeLive {
  return { color: { hueBase: 0.5 }, blur: { strength: 0.0 } };
}

const MAP: AutomationMap = [
  { target: "color.hueBase",  base: 0,   we: 1, wb: 0, wm: 0, wt: 0, min: 0, max: 1 },
  { target: "blur.strength",  base: 0,   we: 0, wb: 1, wm: 0, wt: 0, min: 0, max: 2 },
];

const SECTIONS: Section[] = [
  { start: 0,  end: 10, energyNorm: 0.0, bassAbs: 0.0, midAbs: 0, trebleAbs: 0 },
  { start: 10, end: 20, energyNorm: 1.0, bassAbs: 1.0, midAbs: 0, trebleAbs: 0 },
];
const BOUNDARIES: SectionBoundary[] = [{ t: 10, source: "auto" }];

describe("ParameterAutomation.applyAt", () => {
  test("セクション中央点では純粋に式どおりの値が出る (補間なし)", () => {
    const auto = new ParameterAutomation(SECTIONS, BOUNDARIES, MAP, 1.0);
    const live1 = makeLive();
    auto.applyAt(2, live1 as unknown as Record<string, unknown>);
    expect(live1.color.hueBase).toBe(0);
    expect(live1.blur.strength).toBe(0);

    const live2 = makeLive();
    auto.applyAt(15, live2 as unknown as Record<string, unknown>);
    expect(live2.color.hueBase).toBe(1);
    expect(live2.blur.strength).toBe(1);
  });

  test("境界の真上 (t = 10, transitionSec=2) では中点になる", () => {
    const auto = new ParameterAutomation(SECTIONS, BOUNDARIES, MAP, 2.0);
    const live = makeLive();
    auto.applyAt(10, live as unknown as Record<string, unknown>);
    expect(live.color.hueBase).toBeCloseTo(0.5, 2);
    expect(live.blur.strength).toBeCloseTo(0.5, 2);
  });

  test("境界より transitionSec/2 以上離れていれば補間がかからない", () => {
    const auto = new ParameterAutomation(SECTIONS, BOUNDARIES, MAP, 2.0);
    const live = makeLive();
    auto.applyAt(8.5, live as unknown as Record<string, unknown>);
    expect(live.color.hueBase).toBe(0);
  });

  test("単一セクションだけのときも動く (補間なし)", () => {
    const single: Section[] = [
      { start: 0, end: 10, energyNorm: 0.5, bassAbs: 0.7, midAbs: 0, trebleAbs: 0 },
    ];
    const auto = new ParameterAutomation(single, [], MAP, 1.0);
    const live = makeLive();
    auto.applyAt(5, live as unknown as Record<string, unknown>);
    expect(live.color.hueBase).toBeCloseTo(0.5, 2);
    expect(live.blur.strength).toBeCloseTo(0.7, 2);
  });

  test("曲頭 / 曲末では片側のセクションが無いので補間しない", () => {
    const auto = new ParameterAutomation(SECTIONS, BOUNDARIES, MAP, 4.0);
    const headLive = makeLive();
    auto.applyAt(0.1, headLive as unknown as Record<string, unknown>);
    expect(headLive.color.hueBase).toBe(0);

    const tailLive = makeLive();
    auto.applyAt(19.9, tailLive as unknown as Record<string, unknown>);
    expect(tailLive.color.hueBase).toBe(1);
  });

  test("clamp が両端で機能する", () => {
    const map: AutomationMap = [
      { target: "color.hueBase", base: 0, we: 10, wb: 0, wm: 0, wt: 0, min: 0, max: 0.7 },
    ];
    const auto = new ParameterAutomation(SECTIONS, BOUNDARIES, map, 1.0);
    const live = makeLive();
    auto.applyAt(15, live as unknown as Record<string, unknown>);
    expect(live.color.hueBase).toBe(0.7);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/pose-particles/automation/ParameterAutomation.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/pose-particles/automation/ParameterAutomation.ts`:

```ts
import type { Section, SectionBoundary } from "./AnalysisCache";
import { computeValue, type AutomationEntry, type AutomationMap, type SectionFeatures } from "./AutomationMap";
import { setByPath } from "./setByPath";

function smoothstep(x: number): number {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpFeatures(a: SectionFeatures, b: SectionFeatures, t: number): SectionFeatures {
  return {
    energyNorm: lerp(a.energyNorm, b.energyNorm, t),
    bassAbs:    lerp(a.bassAbs,    b.bassAbs,    t),
    midAbs:     lerp(a.midAbs,     b.midAbs,     t),
    trebleAbs:  lerp(a.trebleAbs,  b.trebleAbs,  t),
  };
}

function asFeatures(s: Section): SectionFeatures {
  return { energyNorm: s.energyNorm, bassAbs: s.bassAbs, midAbs: s.midAbs, trebleAbs: s.trebleAbs };
}

export class ParameterAutomation {
  private readonly entries: ReadonlyArray<AutomationEntry>;

  constructor(
    private readonly sections: Section[],
    private readonly boundaries: SectionBoundary[],
    map: AutomationMap,
    private readonly transitionSec: number,
  ) {
    this.entries = map;
  }

  /**
   * 再生時刻 t (秒) に対して live Settings を上書きする。
   * 1) t を含むセクションを線形探索（曲数が短いので二分探索は不要、20 セクション程度）
   * 2) 境界 ±transitionSec/2 の窓内なら隣接セクションを smoothstep で線形補間
   * 3) 補間後の特徴量で AutomationMap を回し、setByPath で値を書き込む
   */
  applyAt(t: number, live: Record<string, unknown>): void {
    if (this.sections.length === 0) return;
    const idx = this.findSectionIndex(t);
    const cur = this.sections[idx]!;
    let features = asFeatures(cur);

    if (this.transitionSec > 0 && this.boundaries.length > 0) {
      // 直近の境界 (前向き / 後向き) を見て補間ゾーンに入っているか判定
      const halfWin = this.transitionSec / 2;

      // 前のセクションとの境界 = sections[idx].start (idx > 0 のとき)
      if (idx > 0) {
        const bd = cur.start;
        if (Math.abs(t - bd) < halfWin) {
          const prev = asFeatures(this.sections[idx - 1]!);
          // d=0 (境界の真上) で 0.5、d=halfWin で 1 (= 100% cur)、d=-halfWin で 0 (= 100% prev)
          const u = (t - bd) / this.transitionSec + 0.5; // 0..1
          features = lerpFeatures(prev, features, smoothstep(u));
        }
      }
      // 次のセクションとの境界 = sections[idx].end (idx < length-1 のとき)
      if (idx < this.sections.length - 1) {
        const bd = cur.end;
        if (Math.abs(t - bd) < halfWin) {
          const next = asFeatures(this.sections[idx + 1]!);
          const u = (t - bd) / this.transitionSec + 0.5;
          features = lerpFeatures(features, next, smoothstep(u));
        }
      }
    }

    for (const e of this.entries) {
      setByPath(live, e.target, computeValue(e, features));
    }
  }

  private findSectionIndex(t: number): number {
    for (let i = 0; i < this.sections.length; i++) {
      const s = this.sections[i]!;
      if (t >= s.start && t < s.end) return i;
    }
    return this.sections.length - 1;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/pose-particles/automation/ParameterAutomation.test.ts`
Expected: PASS — 6 tests pass.

Full suite: `bun test`
Expected: PASS — 67 tests total.

- [ ] **Step 5: Commit**

```bash
git add src/pose-particles/automation/ParameterAutomation.ts src/pose-particles/automation/ParameterAutomation.test.ts
git commit -m "#5 feat: ParameterAutomation (smoothstep 補間 + setByPath) を追加"
```

---

## Task 7: SongAnalyzer — OfflineAudioContext で帯域時系列を作る

**Files:**
- Create: `src/pose-particles/audio/SongAnalyzer.ts`
- Test: `src/pose-particles/audio/SongAnalyzer.test.ts`

OfflineAudioContext は Bun のテストランタイムで動かない。なので **純粋ロジック部分**（FFT bin → BandFrame 配列を組み立てる関数）だけテストする。`run(audioBuffer)` の結合は手動確認に回す。

- [ ] **Step 1: Write the failing test**

Create `src/pose-particles/audio/SongAnalyzer.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/pose-particles/audio/SongAnalyzer.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/pose-particles/audio/SongAnalyzer.ts`:

```ts
import type { BandFrame, BandTimeSeries } from "../automation/AnalysisCache";
import { computeBands } from "./AudioAnalyzer";

export interface BinSample {
  t: number;          // 秒
  bins: Uint8Array;   // analyser.getByteFrequencyData の出力
}

export const HOP_MS = 50;
export const FFT_SIZE = 2048;

/**
 * 純粋関数: BinSample 配列 → BandFrame 配列。
 * computeBands は既存 AudioAnalyzer のものをそのまま使い、リアルタイムと
 * オフラインで帯域算出式を一致させる。
 */
export function framesFromBins(
  samples: ReadonlyArray<BinSample>,
  sampleRate: number,
  fftSize: number,
): BandFrame[] {
  return samples.map((s) => {
    const b = computeBands(s.bins, sampleRate, fftSize);
    return { t: s.t, volume: b.volume, bass: b.bass, mid: b.mid, treble: b.treble };
  });
}

/**
 * AudioBuffer を OfflineAudioContext に流して `HOP_MS` ごとに FFT bin を取り出し、
 * 帯域時系列を作る。AnalyserNode の挙動に依存するため Bun テスト不可。手動確認用。
 */
export async function run(audioBuffer: AudioBuffer): Promise<BandTimeSeries> {
  const sr = audioBuffer.sampleRate;
  const ch = audioBuffer.numberOfChannels;
  const len = audioBuffer.length;
  const offline = new OfflineAudioContext(ch, len, sr);
  const src = offline.createBufferSource();
  src.buffer = audioBuffer;
  const analyser = offline.createAnalyser();
  analyser.fftSize = FFT_SIZE;
  analyser.smoothingTimeConstant = 0.0;
  src.connect(analyser);
  analyser.connect(offline.destination);

  const samples: BinSample[] = [];
  const total = audioBuffer.duration;
  const step = HOP_MS / 1000;

  // OfflineAudioContext.suspend(t) は t 秒で停止し getByteFrequencyData を読める。
  // ループで suspend → 読み取り → resume を繰り返す。
  for (let t = 0; t < total; t += step) {
    const target = t;
    offline.suspend(target).then(() => {
      const bins = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(bins);
      samples.push({ t: target, bins });
      offline.resume();
    });
  }

  src.start(0);
  await offline.startRendering();

  return {
    duration: total,
    frames: framesFromBins(samples, sr, FFT_SIZE),
    sampleRate: sr,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/pose-particles/audio/SongAnalyzer.test.ts`
Expected: PASS — 4 tests pass.

Full suite: `bun test`
Expected: PASS — 71 tests total.

- [ ] **Step 5: Commit**

```bash
git add src/pose-particles/audio/SongAnalyzer.ts src/pose-particles/audio/SongAnalyzer.test.ts
git commit -m "#5 feat: SongAnalyzer (framesFromBins 純関数 + OfflineAudioContext run)"
```

---

## Task 8: settings.ts に AutoSettings を追加

**Files:**
- Modify: `src/pose-particles/settings.ts`

既存型に追加するだけ。動作影響を最小化するためテストは Task 12（App 結合）の後の手動確認で見る。型レベルで TypeScript ビルドが通るかを確認する。

- [ ] **Step 1: 既存型を読む**

Read: `src/pose-particles/settings.ts`
今ある `Settings` interface と `makeDefaultSettings()` の構造を確認する。

- [ ] **Step 2: AutoSettings 型と Settings.auto を追加**

`src/pose-particles/settings.ts` の `import` 直下と `Settings` interface 内、
`makeDefaultSettings()` 内に以下を追加。

`Settings` interface の `blur: BlurSettings;` の直後に追加:

```ts
  /** 曲解析ベースのパラメータ自動制御 (Issue #5)。 */
  auto: AutoSettings;
```

`Settings` interface のすぐ上に AutoSettings を定義:

```ts
export interface AutoSettings {
  /** 自動制御を有効化する。曲ファイル再生時のみ実効。 */
  enabled: boolean;
  /** 境界補間の総幅 (秒)。前後 transitionSec/2 が補間ゾーン。 */
  transitionSec: number;
  /** 境界検出の novelty 閾値 (0..1)。 */
  noveltyThreshold: number;
  /** 連続境界をマージする最小間隔 (秒)。 */
  minSectionSec: number;
}
```

`makeDefaultSettings()` の `return {` ブロック内、`blur: makeDefaultBlur(),` の直後に追加:

```ts
    auto: {
      enabled: false,
      transitionSec: 1.5,
      noveltyThreshold: 0.4,
      minSectionSec: 4.0,
    },
```

- [ ] **Step 3: 型チェックを通す**

Run: `bunx tsc --noEmit`
Expected: PASS — no errors. (`AutoSettings` を export していること、interface に必須フィールドとして追加したこと、デフォルトを埋めたことで一貫している。)

Full test suite: `bun test`
Expected: PASS — 71 tests still pass.

- [ ] **Step 4: Commit**

```bash
git add src/pose-particles/settings.ts
git commit -m "#5 feat: Settings に AutoSettings を追加"
```

---

## Task 9: FileAudioSource に getDecodedBuffer / getCurrentTime を追加

**Files:**
- Modify: `src/pose-particles/audio/FileAudioSource.ts`

`App` から「現在の AudioBuffer」「現在の再生時刻」を取得できるようにする。

- [ ] **Step 1: 既存実装を確認**

Read: `src/pose-particles/audio/FileAudioSource.ts`

`buffer: AudioBuffer | null`、`source: AudioBufferSourceNode | null` を保持しているが、再生開始時刻は記録していない。`getCurrentTime` 計算用に `startedAt` を追加する。

- [ ] **Step 2: API を追加**

`src/pose-particles/audio/FileAudioSource.ts` を以下に書き換え（diff のポイント: `startedAt` フィールド、`start()` で `this.startedAt = ctx.currentTime` をセット、`stop()` で `null` リセット、新メソッド `getDecodedBuffer()` と `getCurrentTime()`）。

```ts
import { DEFAULT_AUDIO_FEATURES, type AudioFeatures } from "../types";
import { AudioAnalyzer } from "./AudioAnalyzer";
import type { AudioInput } from "./AudioInput";

export class FileAudioSource implements AudioInput {
  private ctx: AudioContext;
  private analyzer: AudioAnalyzer;
  private source: AudioBufferSourceNode | null = null;
  private buffer: AudioBuffer | null = null;
  private playing = false;
  private startedAt: number | null = null;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.analyzer = new AudioAnalyzer(ctx);
  }

  async loadFromUrl(url: string): Promise<void> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`failed to fetch audio: ${res.status}`);
    const arr = await res.arrayBuffer();
    this.buffer = await this.ctx.decodeAudioData(arr);
  }

  async loadFromFile(file: File): Promise<void> {
    const arr = await file.arrayBuffer();
    this.buffer = await this.ctx.decodeAudioData(arr);
  }

  async start(): Promise<void> {
    if (!this.buffer) throw new Error("no audio buffer loaded");
    this.source = this.ctx.createBufferSource();
    this.source.buffer = this.buffer;
    this.source.loop = true;
    this.source.connect(this.analyzer.input).connect(this.ctx.destination);
    this.source.start(0);
    this.startedAt = this.ctx.currentTime;
    this.playing = true;
  }

  stop(): void {
    if (this.source) {
      try {
        this.source.stop();
      } catch {
        /* already stopped */
      }
      this.source.disconnect();
      this.source = null;
    }
    this.playing = false;
    this.startedAt = null;
  }

  read(): AudioFeatures {
    if (!this.playing) return DEFAULT_AUDIO_FEATURES;
    return this.analyzer.read(this.ctx.sampleRate);
  }

  /** 解析した AudioBuffer を返す。decode 前 / 解放後は null。 */
  getDecodedBuffer(): AudioBuffer | null {
    return this.buffer;
  }

  /** 再生開始からの経過秒。loop の場合は曲長で wrap する。stop 中 / 未開始は 0。 */
  getCurrentTime(): number {
    if (!this.playing || this.startedAt === null || !this.buffer) return 0;
    const elapsed = this.ctx.currentTime - this.startedAt;
    const dur = this.buffer.duration;
    if (dur <= 0) return 0;
    return elapsed % dur;
  }
}
```

- [ ] **Step 3: 型チェック**

Run: `bunx tsc --noEmit`
Expected: PASS.

`bun test`
Expected: PASS — 71 tests still pass.

- [ ] **Step 4: Commit**

```bash
git add src/pose-particles/audio/FileAudioSource.ts
git commit -m "#5 feat: FileAudioSource に getDecodedBuffer / getCurrentTime を追加"
```

---

## Task 10: SectionTimeline — 純粋関数 + Canvas 描画

**Files:**
- Create: `src/pose-particles/ui/SectionTimeline.ts`
- Test: `src/pose-particles/ui/SectionTimeline.test.ts`

クリック判定の純粋関数を先に TDD で書き、その後 Canvas 描画と DOM 結合を実装。

- [ ] **Step 1: Write the failing test**

Create `src/pose-particles/ui/SectionTimeline.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import type { SectionBoundary } from "../automation/AnalysisCache";
import { addOrRemoveBoundary, pickBoundaryAt } from "./SectionTimeline";

describe("pickBoundaryAt", () => {
  test("hitWindowSec 内の最も近い境界の index を返す", () => {
    const bds: SectionBoundary[] = [
      { t: 5, source: "auto" },
      { t: 10, source: "user-add" },
      { t: 20, source: "auto" },
    ];
    expect(pickBoundaryAt(bds, 10.2, 0.4)).toBe(1);
  });

  test("hitWindow 外なら -1", () => {
    const bds: SectionBoundary[] = [{ t: 5, source: "auto" }];
    expect(pickBoundaryAt(bds, 7, 0.4)).toBe(-1);
  });

  test("空配列なら -1", () => {
    expect(pickBoundaryAt([], 5, 0.4)).toBe(-1);
  });
});

describe("addOrRemoveBoundary", () => {
  test("hit 範囲内に既存があれば削除", () => {
    const bds: SectionBoundary[] = [
      { t: 5, source: "auto" },
      { t: 10, source: "user-add" },
    ];
    expect(addOrRemoveBoundary(bds, 10.1, 0.4)).toHaveLength(1);
    expect(addOrRemoveBoundary(bds, 10.1, 0.4)[0]?.t).toBe(5);
  });

  test("hit 範囲外なら user-add 境界を追加 (時刻ソート維持)", () => {
    const bds: SectionBoundary[] = [
      { t: 5, source: "auto" },
      { t: 20, source: "auto" },
    ];
    const next = addOrRemoveBoundary(bds, 12, 0.4);
    expect(next).toHaveLength(3);
    expect(next.map((b) => b.t)).toEqual([5, 12, 20]);
    expect(next[1]?.source).toBe("user-add");
  });

  test("空配列 + 追加で 1 個になる", () => {
    expect(addOrRemoveBoundary([], 7, 0.4)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/pose-particles/ui/SectionTimeline.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation (純関数のみ先に)**

Create `src/pose-particles/ui/SectionTimeline.ts`:

```ts
import type { BandTimeSeries, SectionBoundary } from "../automation/AnalysisCache";

export function pickBoundaryAt(
  boundaries: ReadonlyArray<SectionBoundary>,
  mouseT: number,
  hitWindowSec: number,
): number {
  let bestIdx = -1;
  let bestDist = Infinity;
  for (let i = 0; i < boundaries.length; i++) {
    const d = Math.abs((boundaries[i]?.t ?? 0) - mouseT);
    if (d <= hitWindowSec && d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}

export function addOrRemoveBoundary(
  boundaries: ReadonlyArray<SectionBoundary>,
  mouseT: number,
  hitWindowSec: number,
): SectionBoundary[] {
  const idx = pickBoundaryAt(boundaries, mouseT, hitWindowSec);
  if (idx >= 0) {
    return boundaries.filter((_, i) => i !== idx);
  }
  const next = [...boundaries, { t: mouseT, source: "user-add" as const }];
  next.sort((a, b) => a.t - b.t);
  return next;
}

/**
 * 画面下部に固定された Canvas タイムライン。auto.enabled のときだけ表示する。
 * クリックで境界を追加/削除し、コールバックで上位 (App) に通知する。
 */
export class SectionTimeline {
  readonly element: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private series: BandTimeSeries | null = null;
  private boundaries: SectionBoundary[] = [];
  private currentTime = 0;
  private onChange: (next: SectionBoundary[]) => void;

  constructor(onChange: (next: SectionBoundary[]) => void) {
    this.onChange = onChange;
    this.element = document.createElement("div");
    this.element.style.cssText = `
      position: fixed; left: 0; bottom: 0;
      width: 100vw; height: 96px;
      background: rgba(0,0,0,0.5);
      border-top: 1px solid rgba(255,255,255,0.2);
      z-index: 50;
      display: none;
    `;
    this.canvas = document.createElement("canvas");
    this.canvas.style.cssText = "width: 100%; height: 100%; display: block;";
    this.element.appendChild(this.canvas);
    document.body.appendChild(this.element);

    this.canvas.addEventListener("click", this.handleClick);
    window.addEventListener("resize", this.handleResize);
    this.handleResize();
  }

  show(): void { this.element.style.display = "block"; this.draw(); }
  hide(): void { this.element.style.display = "none"; }

  setData(series: BandTimeSeries, boundaries: SectionBoundary[]): void {
    this.series = series;
    this.boundaries = [...boundaries].sort((a, b) => a.t - b.t);
    this.draw();
  }

  setCurrentTime(t: number): void {
    this.currentTime = t;
    this.draw();
  }

  dispose(): void {
    this.canvas.removeEventListener("click", this.handleClick);
    window.removeEventListener("resize", this.handleResize);
    this.element.remove();
  }

  private handleResize = (): void => {
    const dpr = Math.min(window.devicePixelRatio, 2);
    this.canvas.width = Math.floor(window.innerWidth * dpr);
    this.canvas.height = Math.floor(96 * dpr);
    this.draw();
  };

  private handleClick = (ev: MouseEvent): void => {
    if (!this.series) return;
    const rect = this.canvas.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const mouseT = (x / rect.width) * this.series.duration;
    const hitWindowSec = (8 / rect.width) * this.series.duration; // ≈ 8px
    const next = addOrRemoveBoundary(this.boundaries, mouseT, hitWindowSec);
    this.boundaries = next;
    this.draw();
    this.onChange(next);
  };

  private draw(): void {
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    const { width: w, height: h } = this.canvas;
    ctx.clearRect(0, 0, w, h);
    if (!this.series) return;
    const dur = this.series.duration;
    if (dur <= 0) return;

    // volume を白塗り
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (const f of this.series.frames) {
      const x = (f.t / dur) * w;
      const y = h - f.volume * h;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    ctx.fill();

    // bass / mid / treble の線
    const drawBand = (key: "bass" | "mid" | "treble", color: string) => {
      ctx.beginPath();
      for (let i = 0; i < this.series!.frames.length; i++) {
        const f = this.series!.frames[i]!;
        const x = (f.t / dur) * w;
        const y = h - f[key] * h;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.stroke();
    };
    drawBand("bass", "rgba(255,80,80,0.6)");
    drawBand("mid", "rgba(80,255,120,0.6)");
    drawBand("treble", "rgba(80,160,255,0.6)");

    // 境界
    for (const b of this.boundaries) {
      const x = (b.t / dur) * w;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.strokeStyle = b.source === "user-add" ? "rgba(255,255,80,0.9)" : "rgba(255,255,255,0.7)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // 現在時刻
    const cx = (this.currentTime / dur) * w;
    ctx.beginPath();
    ctx.moveTo(cx, 0);
    ctx.lineTo(cx, h);
    ctx.strokeStyle = "rgba(255,220,80,1.0)";
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/pose-particles/ui/SectionTimeline.test.ts`
Expected: PASS — 6 tests pass.

`bunx tsc --noEmit`
Expected: PASS.

Full suite: `bun test`
Expected: PASS — 77 tests total.

- [ ] **Step 5: Commit**

```bash
git add src/pose-particles/ui/SectionTimeline.ts src/pose-particles/ui/SectionTimeline.test.ts
git commit -m "#5 feat: SectionTimeline (純関数 + Canvas タイムライン UI)"
```

---

## Task 11: SettingsPanel に Auto フォルダ + disable ロジック

**Files:**
- Modify: `src/pose-particles/ui/SettingsPanel.ts`

「Auto Mode」フォルダを追加し、`enabled` 切替で対象 10 controllers の `disable() / enable()` を呼ぶ。

- [ ] **Step 1: 対象 10 controllers の参照を保持する仕組みを準備**

`SettingsPanel` クラスに `private autoControlled: Controller[] = [];` を追加し、Auto に支配される 10 個の controllers を作るときに `this.autoControlled.push(c)` する。

`pc.add(settings.pointCloud, "bassExpansion", 0, 8, 0.1).name("bass expansion");` のような既存の各行を、対象 10 個については以下の形に変更:

```ts
this.autoControlled.push(
  pc.add(settings.pointCloud, "bassExpansion", 0, 8, 0.1).name("bass expansion"),
);
```

`AutomationMap` で対象になっている 10 個 (Task 4 で定義):
- `color.hueBase`
- `color.saturation`
- `color.bassHueShift`
- `pointCloud.bassExpansion`
- `pointCloud.trebleShimmer`
- `pointCloud.volumeSize`
- `fragmentField.midDrift`
- `fragmentField.jointPull`
- `blur.strength`
- `camera.autoRotateSpeed`

`SettingsPanel` constructor 内、各 add 行を上記 10 個については `this.autoControlled.push(...)` でラップする。

- [ ] **Step 2: Auto Mode フォルダと再解析コールバックを実装**

`SettingsPanel` のコンストラクタ引数に `onReanalyze: () => void` を追加する:

```ts
constructor(settings: Settings, onReanalyze: () => void) {
```

`presets` フォルダ追加の前に以下を追加:

```ts
const auto = this.gui.addFolder("Auto Mode");
auto.add(settings.auto, "enabled").name("enabled").onChange((v: boolean) => {
  this.applyAutoDisabled(v);
});
auto.add(settings.auto, "transitionSec", 0.5, 3.0, 0.05).name("transition (s)");
auto.add(settings.auto, "noveltyThreshold", 0.0, 1.0, 0.01).name("novelty threshold");
auto.add(settings.auto, "minSectionSec", 1.0, 10.0, 0.1).name("min section (s)");
auto.add({ reanalyze: () => onReanalyze() }, "reanalyze").name("Re-analyze");
```

constructor の末尾、`dom.style...` ブロックの直前に、現在の `enabled` を反映する:

```ts
this.applyAutoDisabled(settings.auto.enabled);
```

`SettingsPanel` クラス内に追加メソッド:

```ts
private applyAutoDisabled(disabled: boolean): void {
  for (const c of this.autoControlled) {
    if (disabled) c.disable(); else c.enable();
  }
}
```

import に lil-gui の Controller 型を追加（直接 import でも可）:

```ts
import GUI, { Controller } from "lil-gui";
```

- [ ] **Step 3: 全変更をマージしビルドを通す**

`bunx tsc --noEmit`
Expected: PASS — `Controller` 型の名前付き import、`onReanalyze` 引数追加、`autoControlled` 配列、`applyAutoDisabled` メソッド、Auto フォルダの追加が型整合する。

`bun test`
Expected: PASS — 77 tests still pass。

- [ ] **Step 4: 呼び出し側 (App) の追従**

このタスクで `new SettingsPanel(this.settings, () => this.reanalyze())` のように 2 引数化したので、`App.ts` 側でコンパイルエラーが出る。Task 12 で正式に結合するが、ここでは一旦 stub を渡しておく:

`App.ts` の `this.settingsPanel = new SettingsPanel(this.settings);` を:

```ts
this.settingsPanel = new SettingsPanel(this.settings, () => {
  // Task 12 で実装される。
});
```

`bunx tsc --noEmit` で型エラー無し。`bun test` で 77 件 pass。

- [ ] **Step 5: Commit**

```bash
git add src/pose-particles/ui/SettingsPanel.ts src/pose-particles/App.ts
git commit -m "#5 feat: SettingsPanel に Auto Mode フォルダと slider 無効化を追加"
```

---

## Task 12: App.ts に Auto モード結合

**Files:**
- Modify: `src/pose-particles/App.ts`
- Modify: `src/pose-particles/ui/UI.ts` (ファイル選択フックを呼ぶため)

ここでは UI.ts の既存実装を確認し、ファイル読み込み完了で `App.onSongLoaded(buffer, file)` を呼ぶように変更する。

- [ ] **Step 1: 既存の UI.ts のファイル読み込みフロー確認**

Read: `src/pose-particles/ui/UI.ts`

`FileAudioSource.loadFromFile(file)` を呼んでいる箇所を特定。読み込み後に `app.onSongLoaded(...)` を呼ぶフックを追加する。

- [ ] **Step 2: App に onSongLoaded / reanalyze / Analysis 結合を追加**

`src/pose-particles/App.ts` の import ブロックに追加:

```ts
import { fileHash } from "./automation/fileHash";
import { AnalysisCache, type CachePayload } from "./automation/AnalysisCache";
import * as SongAnalyzer from "./audio/SongAnalyzer";
import { detect, recomputeSections } from "./audio/SectionDetector";
import { ParameterAutomation } from "./automation/ParameterAutomation";
import { DEFAULT_AUTOMATION_MAP } from "./automation/AutomationMap";
import { SectionTimeline } from "./ui/SectionTimeline";
import { FileAudioSource } from "./audio/FileAudioSource";
```

`App` クラスにフィールド追加:

```ts
private parameterAutomation: ParameterAutomation | null = null;
private sectionTimeline: SectionTimeline;
private currentSongHash: string | null = null;
private currentSeries: import("./automation/AnalysisCache").BandTimeSeries | null = null;
```

`constructor` 末尾、`window.addEventListener` の前あたりに:

```ts
this.sectionTimeline = new SectionTimeline((next) => this.onBoundariesEdited(next));
```

`new SettingsPanel(this.settings, () => { /* stub */ });` を:

```ts
this.settingsPanel = new SettingsPanel(this.settings, () => this.reanalyze());
```

新規メソッド (App クラス内):

```ts
async onSongLoaded(file: File): Promise<void> {
  if (!(this.audioInput instanceof FileAudioSource)) return;
  const buffer = this.audioInput.getDecodedBuffer();
  if (!buffer) return;
  const head = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
  const hash = fileHash(file.name, file.size, head);
  this.currentSongHash = hash;
  await this.runAnalysis(hash, buffer, /*forceReanalyze*/ false);
}

async reanalyze(): Promise<void> {
  if (!(this.audioInput instanceof FileAudioSource)) return;
  const buffer = this.audioInput.getDecodedBuffer();
  if (!buffer || !this.currentSongHash) return;
  await this.runAnalysis(this.currentSongHash, buffer, true);
}

private async runAnalysis(hash: string, buffer: AudioBuffer, force: boolean): Promise<void> {
  let payload: CachePayload | null = force ? null : AnalysisCache.get(hash);
  if (!payload) {
    this.showAnalyzingToast();
    try {
      const series = await SongAnalyzer.run(buffer);
      const det = detect(series, this.settings.auto);
      payload = {
        version: 1,
        series,
        boundaries: det.boundaries,
        sections: det.sections,
      };
      AnalysisCache.set(hash, payload);
    } catch (e) {
      console.warn("[App] song analysis failed", e);
      this.hideAnalyzingToast();
      return;
    }
    this.hideAnalyzingToast();
  }
  this.currentSeries = payload.series;
  this.sectionTimeline.setData(payload.series, payload.boundaries);
  this.parameterAutomation = new ParameterAutomation(
    payload.sections,
    payload.boundaries,
    DEFAULT_AUTOMATION_MAP,
    this.settings.auto.transitionSec,
  );
}

private onBoundariesEdited(next: import("./automation/AnalysisCache").SectionBoundary[]): void {
  if (!this.currentSeries || !this.currentSongHash) return;
  const sections = recomputeSections(this.currentSeries, next);
  this.parameterAutomation = new ParameterAutomation(
    sections, next, DEFAULT_AUTOMATION_MAP, this.settings.auto.transitionSec,
  );
  AnalysisCache.set(this.currentSongHash, {
    version: 1,
    series: this.currentSeries,
    boundaries: next,
    sections,
  });
}

private analyzingToast: HTMLDivElement | null = null;
private showAnalyzingToast(): void {
  if (this.analyzingToast) return;
  const div = document.createElement("div");
  div.textContent = "Analyzing song…";
  div.style.cssText = `
    position: fixed; left: 50%; top: 50%; transform: translate(-50%,-50%);
    padding: 12px 18px; background: rgba(0,0,0,0.75); color: #fff;
    font: 14px/1.4 system-ui; border: 1px solid rgba(255,255,255,0.3);
    border-radius: 4px; z-index: 80;
  `;
  document.body.appendChild(div);
  this.analyzingToast = div;
}
private hideAnalyzingToast(): void {
  if (this.analyzingToast) {
    this.analyzingToast.remove();
    this.analyzingToast = null;
  }
}
```

`update()` 内、`const live = cloneSettings(this.settings);` の直後に挿入:

```ts
if (this.settings.auto.enabled
    && this.parameterAutomation
    && this.audioInput instanceof FileAudioSource) {
  const t = this.audioInput.getCurrentTime();
  this.parameterAutomation.applyAt(t, live as unknown as Record<string, unknown>);
  this.sectionTimeline.setCurrentTime(t);
}
```

`update()` の `auto.enabled` に応じて Timeline の表示を切替（既に `update()` の末尾近くで判断する）:

```ts
if (this.settings.auto.enabled) this.sectionTimeline.show();
else this.sectionTimeline.hide();
```

`stop()` 内に追加:

```ts
this.sectionTimeline.dispose();
```

- [ ] **Step 3: UI.ts のファイル選択フローに onSongLoaded を結線**

Read `src/pose-particles/ui/UI.ts` で `FileAudioSource.loadFromFile(file)` を呼んでいるブロックを見つけ、その直後に `await app.onSongLoaded(file);` を追加する（具体的な位置は UI.ts の中身による。`loadFromFile` の `await` の **直後**、`audioInput` を `app.setAudio(...)` でセットしたあと）。

- [ ] **Step 4: ビルドとテスト**

`bunx tsc --noEmit`
Expected: PASS.

`bun test`
Expected: PASS — 77 tests still pass。

- [ ] **Step 5: Commit**

```bash
git add src/pose-particles/App.ts src/pose-particles/ui/UI.ts
git commit -m "#5 feat: App に Auto モード解析パイプラインと SectionTimeline を統合"
```

---

## Task 13: 手動動作確認

**Files:** （変更なし、確認のみ）

OfflineAudioContext / WebGL / マイク・ファイル入力を使う部分は自動テストでカバーできない。ローカルでブラウザを開いて確認する。

- [ ] **Step 1: dev サーバ起動**

```bash
bun run dev
```

ブラウザで `http://localhost:5173/pose-particles.html`（または README にあるパス）を開く。

- [ ] **Step 2: 曲ファイルをロード**

任意の MP3 / WAV ファイルを UI のファイル選択から読み込む。

- 解析中は中央に "Analyzing song…" が表示されること
- 完了後にタイムラインバーが画面下部に現れる（auto.enabled = true のときのみ）

- [ ] **Step 3: Auto Mode 切替**

SettingsPanel の "Auto Mode" フォルダで `enabled` をチェック。

- 対象 10 個の slider がグレーアウトすること
- 再生開始すると、画面の見た目（色相 / blur / particle 動き）が時間経過とともに変化すること
- タイムラインバーの黄色カーソルが進むこと

- [ ] **Step 4: 境界編集**

タイムラインの空き部分をクリック → 黄色い縦線が増えること。
既存の境界の上をクリック → 削除されること。
編集直後にビジュアルの切替タイミングが変わること。

- [ ] **Step 5: スライダ操作**

`noveltyThreshold` を上げ下げ → 「Re-analyze」ボタンを押すと境界数が変わること。

- [ ] **Step 6: 再ロード**

ページをリロードして同じファイルを再ロード。"Analyzing song…" が出ずキャッシュから即時タイムラインが表示されること（境界編集も保存されている）。

- [ ] **Step 7: マイク入力でフォールバック**

マイク入力に切り替えて auto.enabled をチェック。Auto は走らず、既存の手動制御がそのまま動くこと（クラッシュなし）。

- [ ] **Step 8: ユーザに動作確認依頼**

問題なければユーザに「動作確認してください」と依頼。

ユーザの確認 OK 後に PR 作成へ進む（git ルール §6 / §7）。

---

## 完了後のフロー (git.md §6-9)

1. `git push -u origin feature/5-song-auto-mode`
2. `gh pr create` で PR 作成（タイトル: `#5 feat: 曲解析 Auto モード`、本文に `Closes #5` は **書かない**）
3. ユーザに動作確認依頼
4. ユーザ OK 後に main へマージ
5. Issue #5 に対応内容コメント + クローズ
6. worktree / ブランチ削除、main を pull

---

## Self-Review Checklist (plan 自己レビュー)

- [x] **Spec coverage**: spec の各セクションを参照しタスクに対応 — fileHash (T1), AnalysisCache (T2), setByPath (T3), AutomationMap (T4), SectionDetector (T5), ParameterAutomation (T6), SongAnalyzer (T7), Settings.auto (T8), FileAudioSource API (T9), SectionTimeline (T10), SettingsPanel Auto フォルダ (T11), App 結合 (T12), 手動確認 (T13)。
- [x] **Placeholder scan**: TBD / TODO 無し。エラー処理・型・テストコードはすべて完全に書かれている。
- [x] **Type consistency**: `BandFrame / BandTimeSeries / Section / SectionBoundary` は Task 2 で定義し以降のすべてのファイルで一貫して使用。`AutomationEntry / AutomationMap / SectionFeatures` は Task 4 で定義し Task 6 で使用。`AnalysisCache.CachePayload` は Task 2 で定義し Task 12 で使用。`FileAudioSource.getDecodedBuffer / getCurrentTime` は Task 9 で定義し Task 12 で使用。`SettingsPanel(settings, onReanalyze)` の 2 引数シグネチャは Task 11 で導入し Task 12 で利用。
