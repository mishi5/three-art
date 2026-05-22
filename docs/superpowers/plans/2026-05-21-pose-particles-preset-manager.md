# pose-particles プリセット管理機能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** pose-particles に「サムネ + 説明文付きプリセットの登録 / 一覧 / 適用 / 編集 / 削除 / YAML 一式 export-import / 順番・ランダム適用」機能を追加する。

**Architecture:** プリセット永続化と CRUD を `src/pose-particles/presets/` に純粋ロジックとして配置 (PresetStore + storage アダプタ + bundle YAML)。サムネは `WebGLRenderTarget` を毎回作って 256×144 WebP DataURL を生成。UI は独立 DOM の中央オーバーレイモーダル (PresetManagerPanel) を新設し、SettingsPanel は callback 経由で manage / next / random ボタンを足すだけ。既存の単一 `Settings` 保存 (`pose-particles.settings.v1`) と既存 export/import はそのまま温存。

**Tech Stack:** TypeScript, three.js 0.170, lil-gui 0.21, yaml 2.8, bun:test。既存パターンに合わせて DOM ユニットテストは行わず、純関数ヘルパーのみ unit テストし、UI 本体は worktree での手動動作確認で検証する。

- 対象 Issue: https://github.com/mishi5/three-art/issues/26
- 設計: `docs/superpowers/specs/2026-05-21-pose-particles-preset-manager-design.md`

---

## ファイル構成

| 役割 | パス | 区分 |
|---|---|---|
| 型定義 | `src/pose-particles/presets/types.ts` | Create |
| ストア | `src/pose-particles/presets/PresetStore.ts` + `.test.ts` | Create |
| 永続化 | `src/pose-particles/presets/storage.ts` + `.test.ts` | Create |
| YAML | `src/pose-particles/presets/bundle-yaml.ts` + `.test.ts` | Create |
| サムネ | `src/pose-particles/presets/thumbnail-capture.ts` + `.test.ts` | Create |
| Panel ヘルパー | `src/pose-particles/ui/preset-name.ts` + `.test.ts` | Create |
| Panel 本体 | `src/pose-particles/ui/PresetManagerPanel.ts` | Create (no DOM test) |
| SettingsPanel 統合 | `src/pose-particles/ui/SettingsPanel.ts` | Modify |
| 配線 | `src/pose-particles/App.ts` | Modify |

---

## Task 1: Preset 型 & PresetStore CRUD コア

**Files:**
- Create: `src/pose-particles/presets/types.ts`
- Create: `src/pose-particles/presets/PresetStore.ts`
- Test: `src/pose-particles/presets/PresetStore.test.ts`

- [ ] **Step 1.1: 型定義を書く**

`src/pose-particles/presets/types.ts`:

```ts
import type { Settings } from "../settings";

/**
 * 1 プリセット = 設定スナップショット + メタ情報 + サムネ。
 * id は不変、settings は登録時点の値を構造コピーで保持する。
 */
export interface Preset {
  /** crypto.randomUUID() で発番。不変。 */
  id: string;
  /** 表示名。空文字不可 (保存側で "untitled" に強制する)。 */
  name: string;
  /** 説明文。複数行可。空文字許可。 */
  description: string;
  /** "data:image/webp;base64,..." または "data:image/png;base64,..."。 */
  thumbnail: string;
  /** 登録時点の Settings スナップショット (構造コピー)。 */
  settings: Settings;
  /** Date.now()。 */
  createdAt: number;
  /** Date.now()。update のたびに更新。 */
  updatedAt: number;
}

/** YAML 一式 export/import の上位コンテナ。 */
export interface PresetBundle {
  version: 1;
  presets: Preset[];
}

/** ストアの永続化アダプタ。in-memory / localStorage を差し替え可能にする。 */
export interface PresetStorageAdapter {
  /** 失敗時は空 Bundle ({ version: 1, presets: [] }) を返す。throw しない。 */
  read(): PresetBundle;
  /** QuotaExceededError 等は呼び出し側で catch するため throw して良い。 */
  write(bundle: PresetBundle): void;
}

/** add 時に必要な入力。id / createdAt / updatedAt はストアが付与する。 */
export interface PresetInput {
  name: string;
  description: string;
  thumbnail: string;
  settings: Settings;
}

/** update のパッチ。id / createdAt は変更不可。 */
export type PresetPatch = Partial<Pick<Preset, "name" | "description" | "thumbnail" | "settings">>;

/** ソフトリミット (UI 側で alert)。 */
export const PRESET_LIMIT = 50;
```

- [ ] **Step 1.2: 失敗するテストを書く (CRUD コア)**

`src/pose-particles/presets/PresetStore.test.ts`:

```ts
import { describe, it, expect } from "bun:test";
import { PresetStore } from "./PresetStore";
import type { PresetStorageAdapter, PresetBundle } from "./types";
import { makeDefaultSettings } from "../settings";

function memoryAdapter(initial?: PresetBundle): PresetStorageAdapter {
  let state: PresetBundle = initial ?? { version: 1, presets: [] };
  return {
    read: () => structuredClone(state),
    write: (b) => { state = structuredClone(b); },
  };
}

function sampleInput(name = "x") {
  return {
    name,
    description: "",
    thumbnail: "data:image/webp;base64,AA==",
    settings: makeDefaultSettings(),
  };
}

describe("PresetStore CRUD", () => {
  it("starts empty when adapter is empty", () => {
    const store = new PresetStore(memoryAdapter());
    expect(store.list()).toEqual([]);
  });

  it("add() returns the created preset with id/createdAt/updatedAt set", () => {
    const store = new PresetStore(memoryAdapter());
    const p = store.add(sampleInput("first"));
    expect(p.id).toBeTruthy();
    expect(p.name).toBe("first");
    expect(typeof p.createdAt).toBe("number");
    expect(p.updatedAt).toBe(p.createdAt);
    expect(store.list()).toHaveLength(1);
    expect(store.get(p.id)).toEqual(p);
  });

  it("add() coerces empty name to 'untitled'", () => {
    const store = new PresetStore(memoryAdapter());
    const p = store.add({ ...sampleInput(""), name: "" });
    expect(p.name).toBe("untitled");
  });

  it("list() is sorted by createdAt ascending", async () => {
    const store = new PresetStore(memoryAdapter());
    const a = store.add(sampleInput("a"));
    // ensure monotonically increasing createdAt across calls
    await new Promise((r) => setTimeout(r, 2));
    const b = store.add(sampleInput("b"));
    const ids = store.list().map((p) => p.id);
    expect(ids).toEqual([a.id, b.id]);
  });

  it("update() mutates the named fields and bumps updatedAt", async () => {
    const store = new PresetStore(memoryAdapter());
    const p = store.add(sampleInput("a"));
    await new Promise((r) => setTimeout(r, 2));
    const u = store.update(p.id, { name: "renamed", description: "d" });
    expect(u.name).toBe("renamed");
    expect(u.description).toBe("d");
    expect(u.updatedAt).toBeGreaterThan(p.updatedAt);
    expect(u.createdAt).toBe(p.createdAt);
  });

  it("update() throws for unknown id", () => {
    const store = new PresetStore(memoryAdapter());
    expect(() => store.update("nope", { name: "x" })).toThrow();
  });

  it("remove() drops the preset", () => {
    const store = new PresetStore(memoryAdapter());
    const p = store.add(sampleInput("a"));
    store.remove(p.id);
    expect(store.list()).toEqual([]);
    expect(store.get(p.id)).toBeNull();
  });

  it("remove() is a no-op for unknown id", () => {
    const store = new PresetStore(memoryAdapter());
    expect(() => store.remove("nope")).not.toThrow();
  });

  it("settings are deep-cloned on add (mutating the input later does not affect the store)", () => {
    const store = new PresetStore(memoryAdapter());
    const input = sampleInput("a");
    const p = store.add(input);
    input.settings.color.hueBase = 0.999;
    expect(store.get(p.id)!.settings.color.hueBase).not.toBe(0.999);
  });

  it("persists via the adapter (write is called on add/update/remove)", () => {
    let written = 0;
    const adapter: PresetStorageAdapter = {
      read: () => ({ version: 1, presets: [] }),
      write: () => { written++; },
    };
    const store = new PresetStore(adapter);
    const p = store.add(sampleInput("a"));
    store.update(p.id, { name: "b" });
    store.remove(p.id);
    expect(written).toBe(3);
  });

  it("hydrates from adapter on construction", () => {
    const adapter = memoryAdapter({
      version: 1,
      presets: [{
        id: "fixed",
        name: "seed",
        description: "",
        thumbnail: "",
        settings: makeDefaultSettings(),
        createdAt: 1,
        updatedAt: 1,
      }],
    });
    const store = new PresetStore(adapter);
    expect(store.list()[0].id).toBe("fixed");
  });
});
```

- [ ] **Step 1.3: テストが落ちることを確認**

Run: `cd /Users/shun/dev/three-art/.worktrees/26-preset-manager && bun test src/pose-particles/presets/PresetStore.test.ts`
Expected: FAIL (`PresetStore` モジュール未作成)

- [ ] **Step 1.4: PresetStore CRUD コアを実装**

`src/pose-particles/presets/PresetStore.ts`:

```ts
import type {
  Preset,
  PresetBundle,
  PresetInput,
  PresetPatch,
  PresetStorageAdapter,
} from "./types";

/**
 * プリセットの CRUD + 永続化を担うストア。
 *
 * 設定変更との分離:
 *   add 時に settings は structuredClone で保持するため、呼び出し側の Settings
 *   オブジェクトをその後ライブ編集してもストアには影響しない。
 *
 * 順序:
 *   list() は createdAt 昇順 (= 登録順)。 next preset / random preset で
 *   この順序が UX 上の「登録順」と一致する。
 */
export class PresetStore {
  private bundle: PresetBundle;

  constructor(private readonly adapter: PresetStorageAdapter) {
    this.bundle = adapter.read();
    if (!this.bundle || this.bundle.version !== 1 || !Array.isArray(this.bundle.presets)) {
      this.bundle = { version: 1, presets: [] };
    }
  }

  list(): Preset[] {
    return [...this.bundle.presets].sort((a, b) => a.createdAt - b.createdAt);
  }

  get(id: string): Preset | null {
    return this.bundle.presets.find((p) => p.id === id) ?? null;
  }

  add(input: PresetInput): Preset {
    const now = Date.now();
    const p: Preset = {
      id: cryptoRandomId(),
      name: input.name && input.name.length > 0 ? input.name : "untitled",
      description: input.description,
      thumbnail: input.thumbnail,
      settings: structuredClone(input.settings),
      createdAt: now,
      updatedAt: now,
    };
    this.bundle.presets.push(p);
    this.flush();
    return p;
  }

  update(id: string, patch: PresetPatch): Preset {
    const idx = this.bundle.presets.findIndex((p) => p.id === id);
    if (idx < 0) throw new Error(`preset not found: ${id}`);
    const prev = this.bundle.presets[idx];
    const next: Preset = {
      ...prev,
      ...(patch.name !== undefined ? { name: patch.name.length > 0 ? patch.name : "untitled" } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.thumbnail !== undefined ? { thumbnail: patch.thumbnail } : {}),
      ...(patch.settings !== undefined ? { settings: structuredClone(patch.settings) } : {}),
      updatedAt: Date.now(),
    };
    this.bundle.presets[idx] = next;
    this.flush();
    return next;
  }

  remove(id: string): void {
    const before = this.bundle.presets.length;
    this.bundle.presets = this.bundle.presets.filter((p) => p.id !== id);
    if (this.bundle.presets.length !== before) this.flush();
  }

  private flush(): void {
    this.adapter.write(this.bundle);
  }
}

/** crypto.randomUUID() を使い、未サポート環境 (古いノード等) では fallback。 */
function cryptoRandomId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `p_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
}
```

- [ ] **Step 1.5: テストが通ることを確認**

Run: `cd /Users/shun/dev/three-art/.worktrees/26-preset-manager && bun test src/pose-particles/presets/PresetStore.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 1.6: 全テストも通っていることを確認**

Run: `cd /Users/shun/dev/three-art/.worktrees/26-preset-manager && bun test`
Expected: 既存 197 + 新規 10 = 207 件 PASS

- [ ] **Step 1.7: コミット**

```bash
git add src/pose-particles/presets/
git commit -m "#26 feat: PresetStore CRUD コア (in-memory adapter で TDD)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: PresetStore — replaceAll / toBundle / fromBundle / 50 件上限

**Files:**
- Modify: `src/pose-particles/presets/PresetStore.ts`
- Modify: `src/pose-particles/presets/PresetStore.test.ts`

- [ ] **Step 2.1: 失敗するテストを追加**

`PresetStore.test.ts` の末尾に追加:

```ts
import { PRESET_LIMIT } from "./types";

describe("PresetStore bundle & limit", () => {
  it("toBundle() returns a bundle snapshot ({ version: 1, presets })", () => {
    const store = new PresetStore(memoryAdapter());
    const p = store.add(sampleInput("a"));
    const b = store.toBundle();
    expect(b.version).toBe(1);
    expect(b.presets).toHaveLength(1);
    expect(b.presets[0].id).toBe(p.id);
  });

  it("toBundle() returns a deep copy (mutating result does not affect the store)", () => {
    const store = new PresetStore(memoryAdapter());
    store.add(sampleInput("a"));
    const b = store.toBundle();
    b.presets[0].name = "mutated";
    expect(store.list()[0].name).toBe("a");
  });

  it("fromBundle() replaces all presets and persists", () => {
    const adapter = memoryAdapter();
    const store = new PresetStore(adapter);
    store.add(sampleInput("a"));
    store.fromBundle({
      version: 1,
      presets: [
        { id: "x", name: "X", description: "", thumbnail: "", settings: makeDefaultSettings(), createdAt: 1, updatedAt: 1 },
      ],
    });
    expect(store.list().map((p) => p.id)).toEqual(["x"]);
    expect(adapter.read().presets.map((p) => p.id)).toEqual(["x"]);
  });

  it("replaceAll() works the same and accepts a plain array", () => {
    const store = new PresetStore(memoryAdapter());
    store.replaceAll([
      { id: "y", name: "Y", description: "", thumbnail: "", settings: makeDefaultSettings(), createdAt: 2, updatedAt: 2 },
    ]);
    expect(store.list().map((p) => p.id)).toEqual(["y"]);
  });

  it("add() throws RangeError when PRESET_LIMIT is reached", () => {
    const store = new PresetStore(memoryAdapter());
    for (let i = 0; i < PRESET_LIMIT; i++) store.add(sampleInput(`p${i}`));
    expect(() => store.add(sampleInput("over"))).toThrow(RangeError);
  });
});
```

- [ ] **Step 2.2: テストが落ちることを確認**

Run: `bun test src/pose-particles/presets/PresetStore.test.ts`
Expected: 5 件 FAIL ("toBundle is not a function" 等)

- [ ] **Step 2.3: PresetStore 拡張**

`PresetStore.ts` のクラス内に追記:

```ts
import { PRESET_LIMIT } from "./types";
// (既存 import の下に追記)
```

クラスの `private flush()` の直前に以下を追加:

```ts
toBundle(): PresetBundle {
  return structuredClone(this.bundle);
}

fromBundle(bundle: PresetBundle): void {
  if (bundle.version !== 1) throw new Error(`unsupported bundle version: ${bundle.version}`);
  this.bundle = { version: 1, presets: structuredClone(bundle.presets) };
  this.flush();
}

replaceAll(presets: Preset[]): void {
  this.bundle = { version: 1, presets: structuredClone(presets) };
  this.flush();
}
```

そして `add()` の先頭 (now の代入の前) に上限チェックを追加:

```ts
add(input: PresetInput): Preset {
  if (this.bundle.presets.length >= PRESET_LIMIT) {
    throw new RangeError(`preset limit reached (${PRESET_LIMIT})`);
  }
  const now = Date.now();
  // (以下は既存のまま)
```

- [ ] **Step 2.4: テストが通ることを確認**

Run: `bun test src/pose-particles/presets/PresetStore.test.ts`
Expected: 15 件 PASS

- [ ] **Step 2.5: コミット**

```bash
git add src/pose-particles/presets/
git commit -m "#26 feat: PresetStore に bundle I/O と 50 件上限を追加

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: PresetStore — nextOf / randomOf

**Files:**
- Modify: `src/pose-particles/presets/PresetStore.ts`
- Modify: `src/pose-particles/presets/PresetStore.test.ts`

- [ ] **Step 3.1: 失敗するテストを追加**

`PresetStore.test.ts` の末尾に追加:

```ts
describe("PresetStore navigation", () => {
  it("nextOf(null) returns the first preset in list order", async () => {
    const store = new PresetStore(memoryAdapter());
    const a = store.add(sampleInput("a"));
    await new Promise((r) => setTimeout(r, 2));
    store.add(sampleInput("b"));
    expect(store.nextOf(null)?.id).toBe(a.id);
  });

  it("nextOf(currentId) returns the next preset and wraps to head at the end", async () => {
    const store = new PresetStore(memoryAdapter());
    const a = store.add(sampleInput("a"));
    await new Promise((r) => setTimeout(r, 2));
    const b = store.add(sampleInput("b"));
    expect(store.nextOf(a.id)?.id).toBe(b.id);
    expect(store.nextOf(b.id)?.id).toBe(a.id); // wrap
  });

  it("nextOf() returns null when the store is empty", () => {
    const store = new PresetStore(memoryAdapter());
    expect(store.nextOf(null)).toBeNull();
    expect(store.nextOf("any")).toBeNull();
  });

  it("nextOf(unknownId) returns the first preset (treated as null)", () => {
    const store = new PresetStore(memoryAdapter());
    const a = store.add(sampleInput("a"));
    expect(store.nextOf("nope")?.id).toBe(a.id);
  });

  it("randomOf() never returns the excludeId when there are ≥2 presets", () => {
    const store = new PresetStore(memoryAdapter());
    const a = store.add(sampleInput("a"));
    const b = store.add(sampleInput("b"));
    // rng が 0 (= 先頭) を返してきても、a を除外したいなら b に進むはず。
    const rng = () => 0;
    const r = store.randomOf(a.id, rng);
    expect(r?.id).toBe(b.id);
  });

  it("randomOf(null) returns any preset", () => {
    const store = new PresetStore(memoryAdapter());
    const a = store.add(sampleInput("a"));
    const r = store.randomOf(null, () => 0);
    expect(r?.id).toBe(a.id);
  });

  it("randomOf() returns the only preset even if it matches excludeId", () => {
    const store = new PresetStore(memoryAdapter());
    const a = store.add(sampleInput("a"));
    expect(store.randomOf(a.id, () => 0)?.id).toBe(a.id);
  });

  it("randomOf() returns null when empty", () => {
    const store = new PresetStore(memoryAdapter());
    expect(store.randomOf(null, () => 0)).toBeNull();
  });
});
```

- [ ] **Step 3.2: テストが落ちることを確認**

Run: `bun test src/pose-particles/presets/PresetStore.test.ts`
Expected: 8 件 FAIL ("nextOf is not a function" 等)

- [ ] **Step 3.3: nextOf / randomOf を実装**

`PresetStore.ts` のクラス内 `replaceAll()` の直後に追加:

```ts
/**
 * 登録順で次のプリセットを返す。末尾の次は先頭にラップ。
 * currentId が null / 不明なら先頭。空なら null。
 */
nextOf(currentId: string | null): Preset | null {
  const items = this.list();
  if (items.length === 0) return null;
  if (currentId === null) return items[0];
  const idx = items.findIndex((p) => p.id === currentId);
  if (idx < 0) return items[0];
  return items[(idx + 1) % items.length];
}

/**
 * 直前と被らないランダム選択。1 件しかなければそれを返す。空なら null。
 * rng は [0,1) を返す関数 (デフォルト Math.random)。テストで決定論化できる。
 */
randomOf(excludeId: string | null, rng: () => number = Math.random): Preset | null {
  const items = this.list();
  if (items.length === 0) return null;
  if (items.length === 1) return items[0];
  const pool = excludeId === null
    ? items
    : items.filter((p) => p.id !== excludeId);
  // excludeId が一致してすべて除外されたケースは items.length===1 で先に処理済み。
  const i = Math.min(Math.floor(rng() * pool.length), pool.length - 1);
  return pool[i];
}
```

- [ ] **Step 3.4: テストが通ることを確認**

Run: `bun test`
Expected: 既存 197 + 新規 23 = 220 件 PASS

- [ ] **Step 3.5: コミット**

```bash
git add src/pose-particles/presets/
git commit -m "#26 feat: PresetStore.nextOf / randomOf (rng 注入対応)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: localStorage アダプタ

**Files:**
- Create: `src/pose-particles/presets/storage.ts`
- Create: `src/pose-particles/presets/storage.test.ts`

- [ ] **Step 4.1: 失敗するテストを書く**

`src/pose-particles/presets/storage.test.ts`:

```ts
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
    (globalThis as { localStorage?: MemStorage }).localStorage = makeStubStorage();
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
    (globalThis as { localStorage?: MemStorage }).localStorage = makeStubStorage(true);
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
```

- [ ] **Step 4.2: テストが落ちることを確認**

Run: `bun test src/pose-particles/presets/storage.test.ts`
Expected: FAIL (`./storage` 未作成)

- [ ] **Step 4.3: 実装**

`src/pose-particles/presets/storage.ts`:

```ts
import type { PresetBundle, PresetStorageAdapter } from "./types";

/** localStorage key (新規領域。既存 "pose-particles.settings.v1" とは別)。 */
export const PRESETS_STORAGE_KEY = "pose-particles.presets.v1";

/**
 * localStorage を裏にもつアダプタ。
 *
 * 読み取りは失敗しても throw しない (空 Bundle で続行)。書き込みは
 * QuotaExceededError 等を rethrow するので、呼び出し側で alert する。
 * globalThis.localStorage がない環境 (テストランナー初期状態) では
 * メモリも持たず read=空, write=no-op として安全に動く。
 */
export function localStorageAdapter(key: string = PRESETS_STORAGE_KEY): PresetStorageAdapter {
  return {
    read(): PresetBundle {
      const ls = getStorage();
      if (!ls) return emptyBundle();
      const raw = ls.getItem(key);
      if (raw === null) return emptyBundle();
      try {
        const parsed = JSON.parse(raw) as PresetBundle;
        if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.presets)) {
          return emptyBundle();
        }
        return parsed;
      } catch {
        return emptyBundle();
      }
    },
    write(bundle: PresetBundle): void {
      const ls = getStorage();
      if (!ls) return;
      ls.setItem(key, JSON.stringify(bundle));
    },
  };
}

function emptyBundle(): PresetBundle {
  return { version: 1, presets: [] };
}

function getStorage(): Storage | null {
  const ls = (globalThis as { localStorage?: Storage }).localStorage;
  return ls ?? null;
}
```

- [ ] **Step 4.4: テストが通ることを確認**

Run: `bun test src/pose-particles/presets/storage.test.ts`
Expected: 5 件 PASS

- [ ] **Step 4.5: コミット**

```bash
git add src/pose-particles/presets/storage*
git commit -m "#26 feat: presets/storage.ts — localStorage アダプタ

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: bundle YAML serialize / parse

**Files:**
- Create: `src/pose-particles/presets/bundle-yaml.ts`
- Create: `src/pose-particles/presets/bundle-yaml.test.ts`

- [ ] **Step 5.1: 失敗するテストを書く**

`src/pose-particles/presets/bundle-yaml.test.ts`:

```ts
import { describe, it, expect } from "bun:test";
import { serializeBundleYaml, parseBundleYaml, TRANSPARENT_THUMBNAIL } from "./bundle-yaml";
import { makeDefaultSettings } from "../settings";
import type { PresetBundle } from "./types";

function fixtureBundle(): PresetBundle {
  return {
    version: 1,
    presets: [
      {
        id: "abc",
        name: "Wave Cool",
        description: "lattice mode",
        thumbnail: "data:image/webp;base64,UklGRg==",
        settings: makeDefaultSettings(),
        createdAt: 1730000000000,
        updatedAt: 1730000000000,
      },
    ],
  };
}

describe("bundle YAML", () => {
  it("serializes and re-parses to an equivalent bundle", () => {
    const b = fixtureBundle();
    const text = serializeBundleYaml(b);
    expect(text).toContain("version: 1");
    expect(text).toContain("Wave Cool");
    const back = parseBundleYaml(text);
    expect(back).toEqual(b);
  });

  it("throws for unsupported version", () => {
    expect(() => parseBundleYaml("version: 2\npresets: []\n")).toThrow();
  });

  it("throws when input is not an object with a version", () => {
    expect(() => parseBundleYaml("[1,2,3]")).toThrow();
  });

  it("fills missing name/description/thumbnail/timestamps with safe defaults", () => {
    const text = `version: 1
presets:
  - id: "x"
    settings: ${JSON.stringify(makeDefaultSettings())}
`;
    const b = parseBundleYaml(text);
    expect(b.presets).toHaveLength(1);
    const p = b.presets[0];
    expect(p.id).toBe("x");
    expect(p.name).toBe("untitled");
    expect(p.description).toBe("");
    expect(p.thumbnail).toBe(TRANSPARENT_THUMBNAIL);
    expect(typeof p.createdAt).toBe("number");
    expect(typeof p.updatedAt).toBe("number");
  });

  it("drops entries with missing or non-object settings", () => {
    const text = `version: 1
presets:
  - id: "ok"
    name: "ok"
    settings: ${JSON.stringify(makeDefaultSettings())}
  - id: "no-settings"
    name: "no"
  - id: "bad-settings"
    name: "bad"
    settings: "string-not-object"
`;
    const b = parseBundleYaml(text);
    expect(b.presets.map((p) => p.id)).toEqual(["ok"]);
  });

  it("generates a fresh id when missing", () => {
    const text = `version: 1
presets:
  - name: "noid"
    settings: ${JSON.stringify(makeDefaultSettings())}
`;
    const b = parseBundleYaml(text);
    expect(b.presets[0].id.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 5.2: テストが落ちることを確認**

Run: `bun test src/pose-particles/presets/bundle-yaml.test.ts`
Expected: FAIL (`./bundle-yaml` 未作成)

- [ ] **Step 5.3: 実装**

`src/pose-particles/presets/bundle-yaml.ts`:

```ts
import * as YAML from "yaml";
import type { Preset, PresetBundle } from "./types";

/** 透明 1×1 WebP (任意画像差し替え前のデフォルト)。 */
export const TRANSPARENT_THUMBNAIL =
  "data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA";

export function serializeBundleYaml(b: PresetBundle): string {
  return YAML.stringify(b);
}

/**
 * YAML テキストを PresetBundle にパースする。version が 1 以外、または最低限の
 * 形 (object + presets:array) を満たさない場合は throw する。
 * 各エントリは欠損フィールドを安全側のデフォルトで埋める。
 * settings が欠落・非オブジェクトのエントリは drop する (壊れて見えるよりよい)。
 */
export function parseBundleYaml(text: string): PresetBundle {
  const raw = YAML.parse(text) as unknown;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("bundle YAML must be an object");
  }
  const obj = raw as Record<string, unknown>;
  if (obj.version !== 1) {
    throw new Error(`unsupported preset bundle version: ${String(obj.version)}`);
  }
  if (!Array.isArray(obj.presets)) {
    throw new Error("bundle YAML must have a 'presets' array");
  }
  const presets: Preset[] = [];
  for (const entry of obj.presets) {
    const p = coercePreset(entry);
    if (p) presets.push(p);
  }
  return { version: 1, presets };
}

function coercePreset(entry: unknown): Preset | null {
  if (!entry || typeof entry !== "object") return null;
  const e = entry as Record<string, unknown>;
  if (!e.settings || typeof e.settings !== "object" || Array.isArray(e.settings)) return null;
  const now = Date.now();
  const id = typeof e.id === "string" && e.id.length > 0 ? e.id : fallbackId();
  const name = typeof e.name === "string" && e.name.length > 0 ? e.name : "untitled";
  const description = typeof e.description === "string" ? e.description : "";
  const thumbnail = typeof e.thumbnail === "string" && e.thumbnail.length > 0
    ? e.thumbnail
    : TRANSPARENT_THUMBNAIL;
  const createdAt = typeof e.createdAt === "number" ? e.createdAt : now;
  const updatedAt = typeof e.updatedAt === "number" ? e.updatedAt : createdAt;
  return {
    id, name, description, thumbnail,
    // settings はそのまま渡す (Settings 型に合致しているかは呼び出し側で deepMerge する想定)
    settings: e.settings as Preset["settings"],
    createdAt, updatedAt,
  };
}

function fallbackId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `p_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
}
```

- [ ] **Step 5.4: テストが通ることを確認**

Run: `bun test src/pose-particles/presets/bundle-yaml.test.ts`
Expected: 6 件 PASS

- [ ] **Step 5.5: コミット**

```bash
git add src/pose-particles/presets/bundle-yaml*
git commit -m "#26 feat: presets/bundle-yaml.ts — version=1 round-trip + 欠損フォールバック

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: thumbnail capture

**Files:**
- Create: `src/pose-particles/presets/thumbnail-capture.ts`
- Create: `src/pose-particles/presets/thumbnail-capture.test.ts`

- [ ] **Step 6.1: 失敗するテストを書く**

renderer / scene / camera は重いので、呼び出し順とサイズだけ検証する fake を使う。

`src/pose-particles/presets/thumbnail-capture.test.ts`:

```ts
import { describe, it, expect } from "bun:test";
import { captureThumbnail } from "./thumbnail-capture";

/**
 * 最低限のオフスクリーン canvas が無いと toDataURL が動かないので、bun の
 * グローバルに document を生やしておく必要がある場合のみ自前で stub する。
 * 通常 bun は OffscreenCanvas / document を持たないので、bufferToDataURL は
 * 「呼ばれた」ことだけ検証する内部 hook を使う。
 *
 * テスト戦略:
 *   - WebGLRenderTarget は three.js 本物を使い (Three.js は WebGL コンテキストが
 *     無くてもオブジェクト構築は通る)、renderer / scene / camera はメソッド呼び出しを
 *     記録する fake を渡す。
 *   - readRenderTargetPixels は buf に 0 を埋める fake。
 *   - encode 部は内部 hook (__encodeForTest) を差し替えて固定文字列を返す。
 */

type Call = { name: string; args: unknown[] };

function makeFakeRenderer(): { calls: Call[]; renderer: any } {
  const calls: Call[] = [];
  const renderer = {
    setRenderTarget(rt: unknown) { calls.push({ name: "setRenderTarget", args: [rt] }); },
    render(scene: unknown, camera: unknown) { calls.push({ name: "render", args: [scene, camera] }); },
    readRenderTargetPixels(rt: unknown, x: number, y: number, w: number, h: number, buf: Uint8Array) {
      calls.push({ name: "readRenderTargetPixels", args: [rt, x, y, w, h, buf.length] });
      buf.fill(0);
    },
  };
  return { calls, renderer };
}

describe("captureThumbnail", () => {
  it("renders into a fresh WebGLRenderTarget then disposes it (no leak)", () => {
    const { calls, renderer } = makeFakeRenderer();
    const scene = {} as any;
    const camera = {} as any;
    const url = captureThumbnail(renderer as any, scene, camera, {
      width: 8, height: 4,
      encode: (_buf, w, h) => `data:image/webp;base64,fake-${w}x${h}`,
    });
    // 呼び出し順: setRenderTarget(rt) → render(scene,camera) → readRenderTargetPixels(rt,...) → setRenderTarget(null)
    expect(calls.map((c) => c.name)).toEqual([
      "setRenderTarget",
      "render",
      "readRenderTargetPixels",
      "setRenderTarget",
    ]);
    // 1 回目は rt object、最後は null で reset
    expect(calls[0].args[0]).not.toBeNull();
    expect(calls[3].args[0]).toBeNull();
    // 戻り値が encode の出力
    expect(url).toBe("data:image/webp;base64,fake-8x4");
  });

  it("uses default size 256x144 when not specified", () => {
    const { calls, renderer } = makeFakeRenderer();
    captureThumbnail(renderer as any, {} as any, {} as any, {
      encode: (_buf, w, h) => `data:image/webp;base64,fake-${w}x${h}`,
    });
    const read = calls.find((c) => c.name === "readRenderTargetPixels")!;
    expect(read.args[3]).toBe(256);
    expect(read.args[4]).toBe(144);
  });

  it("passes a buffer of w*h*4 bytes to readRenderTargetPixels", () => {
    const { calls, renderer } = makeFakeRenderer();
    captureThumbnail(renderer as any, {} as any, {} as any, {
      width: 10, height: 5,
      encode: () => "x",
    });
    const read = calls.find((c) => c.name === "readRenderTargetPixels")!;
    expect(read.args[5]).toBe(10 * 5 * 4);
  });
});
```

- [ ] **Step 6.2: テストが落ちることを確認**

Run: `bun test src/pose-particles/presets/thumbnail-capture.test.ts`
Expected: FAIL (`./thumbnail-capture` 未作成)

- [ ] **Step 6.3: 実装**

`src/pose-particles/presets/thumbnail-capture.ts`:

```ts
import * as THREE from "three";

export interface ThumbnailCaptureOptions {
  /** デフォルト 256 */
  width?: number;
  /** デフォルト 144 (16:9) */
  height?: number;
  /** デフォルト "image/webp" */
  mime?: "image/webp" | "image/png";
  /** デフォルト 0.7 */
  quality?: number;
  /** テスト用フック。指定すると Canvas を使わずこの関数の戻り値を返す。 */
  encode?: (buf: Uint8Array, w: number, h: number, mime: string, quality: number) => string;
}

/**
 * シーンを 1 回だけ独立 RT に描き、結果を data URL (WebP/PNG) として返す。
 *
 * preserveDrawingBuffer に依存しないため、毎フレーム保持コストはかからない。
 * RT は呼び出しごとに作って即時 dispose するので GPU メモリも常時占有しない。
 *
 * 注意: BlurPipeline 等の post-process は通っていない「scene+camera のみの
 * 描画結果」が得られる。サムネとしては十分。
 */
export function captureThumbnail(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  opts: ThumbnailCaptureOptions = {},
): string {
  const w = opts.width ?? 256;
  const h = opts.height ?? 144;
  const mime = opts.mime ?? "image/webp";
  const quality = opts.quality ?? 0.7;

  const rt = new THREE.WebGLRenderTarget(w, h, {
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
  });
  try {
    renderer.setRenderTarget(rt);
    renderer.render(scene, camera);
    const buf = new Uint8Array(w * h * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, w, h, buf);
    renderer.setRenderTarget(null);

    const encode = opts.encode ?? encodeWithCanvas;
    return encode(buf, w, h, mime, quality);
  } finally {
    rt.dispose();
  }
}

/**
 * 任意画像ファイルを 256x144 にアスペクト保持で contain 描画して data URL 化する。
 * (UI 側で「サムネ差し替え」ボタンから呼ぶ)
 */
export async function imageToThumbnailDataURL(
  file: File,
  width = 256,
  height = 144,
  mime: "image/webp" | "image/png" = "image/webp",
  quality = 0.7,
): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, width, height);
  // contain
  const scale = Math.min(width / bitmap.width, height / bitmap.height);
  const dw = bitmap.width * scale;
  const dh = bitmap.height * scale;
  const dx = (width - dw) / 2;
  const dy = (height - dh) / 2;
  ctx.drawImage(bitmap, dx, dy, dw, dh);
  bitmap.close?.();
  return canvas.toDataURL(mime, quality);
}

/**
 * WebGL は左下原点・canvas は左上原点なので Y 反転して 2D canvas に描き、
 * toDataURL する。
 */
function encodeWithCanvas(
  buf: Uint8Array, w: number, h: number, mime: string, quality: number,
): string {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return ""; // 取れなければ空 (呼び出し側で fallback)
  const img = ctx.createImageData(w, h);
  // 行単位で上下反転
  const rowBytes = w * 4;
  for (let y = 0; y < h; y++) {
    const src = (h - 1 - y) * rowBytes;
    const dst = y * rowBytes;
    img.data.set(buf.subarray(src, src + rowBytes), dst);
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL(mime, quality);
}
```

- [ ] **Step 6.4: テストが通ることを確認**

Run: `bun test src/pose-particles/presets/thumbnail-capture.test.ts`
Expected: 3 件 PASS

- [ ] **Step 6.5: 全テストも通っていることを確認**

Run: `bun test`
Expected: 既存 197 + 新規 34 = 231 件 PASS

- [ ] **Step 6.6: コミット**

```bash
git add src/pose-particles/presets/thumbnail-capture*
git commit -m "#26 feat: presets/thumbnail-capture — WebGLRenderTarget で 256x144 WebP

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: PresetManagerPanel 用 純関数ヘルパー (name 採番)

DOM 本体は bun:test で扱えないので、純粋ロジックだけ抽出して TDD する。

**Files:**
- Create: `src/pose-particles/ui/preset-name.ts`
- Create: `src/pose-particles/ui/preset-name.test.ts`

- [ ] **Step 7.1: 失敗するテストを書く**

`src/pose-particles/ui/preset-name.test.ts`:

```ts
import { describe, it, expect } from "bun:test";
import { nextDefaultPresetName } from "./preset-name";

describe("nextDefaultPresetName", () => {
  it("returns 'untitled #1' when no presets exist", () => {
    expect(nextDefaultPresetName([])).toBe("untitled #1");
  });

  it("returns 'untitled #N+1' where N is the max existing untitled index", () => {
    expect(nextDefaultPresetName(["untitled #1", "untitled #3"])).toBe("untitled #4");
  });

  it("ignores non-default names", () => {
    expect(nextDefaultPresetName(["Wave Cool", "Funky", "untitled #2"])).toBe("untitled #3");
  });

  it("handles malformed indices safely", () => {
    expect(nextDefaultPresetName(["untitled #abc", "untitled #"])).toBe("untitled #1");
  });
});
```

- [ ] **Step 7.2: テストが落ちることを確認**

Run: `bun test src/pose-particles/ui/preset-name.test.ts`
Expected: FAIL

- [ ] **Step 7.3: 実装**

`src/pose-particles/ui/preset-name.ts`:

```ts
/**
 * 既存プリセット名の配列から、次に提案する "untitled #N" 名を返す。
 * N は既存の "untitled #<整数>" の最大値 + 1。該当が無ければ 1。
 */
export function nextDefaultPresetName(existingNames: string[]): string {
  let max = 0;
  const re = /^untitled #(\d+)$/;
  for (const n of existingNames) {
    const m = re.exec(n);
    if (!m) continue;
    const v = Number.parseInt(m[1], 10);
    if (Number.isFinite(v) && v > max) max = v;
  }
  return `untitled #${max + 1}`;
}
```

- [ ] **Step 7.4: テストが通ることを確認**

Run: `bun test src/pose-particles/ui/preset-name.test.ts`
Expected: 4 件 PASS

- [ ] **Step 7.5: コミット**

```bash
git add src/pose-particles/ui/preset-name*
git commit -m "#26 feat: ui/preset-name — 'untitled #N' 採番ヘルパー

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: PresetManagerPanel 本体 (DOM, 手動確認)

bun:test で DOM 動作確認はしないため、本体は実装のみ。実装後 `bun test` で型・既存全件が落ちないことを確認し、最後にユーザの手動確認で検証する。

**Files:**
- Create: `src/pose-particles/ui/PresetManagerPanel.ts`

- [ ] **Step 8.1: 実装**

`src/pose-particles/ui/PresetManagerPanel.ts`:

```ts
import type { Preset } from "../presets/types";
import type { PresetStore } from "../presets/PresetStore";
import type { Settings } from "../settings";
import { serializeBundleYaml, parseBundleYaml } from "../presets/bundle-yaml";
import { imageToThumbnailDataURL } from "../presets/thumbnail-capture";
import { nextDefaultPresetName } from "./preset-name";

export interface PresetManagerCallbacks {
  /** 「Save current」で使用。現在の Settings を取得 (構造コピー推奨)。 */
  getCurrentSettings: () => Settings;
  /** 選択時に呼ばれる。呼ばれ側で SettingsPanel.applyPreset を実行する。 */
  onApply: (preset: Preset) => void;
  /** 「Save current」で使用。サムネを取得 (data URL)。 */
  captureThumbnail: () => string;
}

/**
 * 中央オーバーレイモーダル。lil-gui の "manage presets…" ボタンから show() する。
 * 表示中は背景クリック / Esc / × で hide()。z-index は SettingsPanel(55) より上 (80)。
 */
export class PresetManagerPanel {
  private root: HTMLDivElement;
  private gridEl: HTMLDivElement;
  private detailEl: HTMLDivElement;
  private activeId: string | null = null;
  private onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape" && this.isVisible()) this.hide();
  };

  constructor(
    private readonly store: PresetStore,
    private readonly callbacks: PresetManagerCallbacks,
  ) {
    this.root = document.createElement("div");
    this.root.style.cssText = `
      position: fixed; inset: 0; z-index: 80;
      background: rgba(0,0,0,0.55);
      display: none;
      font: 13px/1.5 -apple-system, sans-serif;
    `;
    this.root.addEventListener("click", (e) => {
      if (e.target === this.root) this.hide();
    });

    const panel = document.createElement("div");
    panel.style.cssText = `
      max-width: 880px; max-height: 90vh; overflow-y: auto;
      margin: 5vh auto;
      background: #1a1a1a; color: #eee;
      border-radius: 8px; padding: 16px 20px;
      box-shadow: 0 12px 40px rgba(0,0,0,0.5);
    `;
    panel.addEventListener("click", (e) => e.stopPropagation());
    this.root.appendChild(panel);

    // header
    const header = document.createElement("div");
    header.style.cssText = "display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;";
    const title = document.createElement("div");
    title.textContent = "Preset Manager";
    title.style.cssText = "font-size: 16px; font-weight: 600;";
    const close = document.createElement("button");
    close.textContent = "×";
    close.style.cssText = "background: transparent; color: #eee; border: 0; font-size: 22px; cursor: pointer;";
    close.addEventListener("click", () => this.hide());
    header.append(title, close);
    panel.appendChild(header);

    // save current
    const saveBtn = document.createElement("button");
    saveBtn.textContent = "+ Save current as preset";
    saveBtn.style.cssText = "width: 100%; padding: 8px 12px; margin-bottom: 14px; background: #2a3a4a; color: #eee; border: 0; border-radius: 4px; cursor: pointer;";
    saveBtn.addEventListener("click", () => this.onSaveCurrent());
    panel.appendChild(saveBtn);

    // grid
    this.gridEl = document.createElement("div");
    this.gridEl.style.cssText = "display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px;";
    panel.appendChild(this.gridEl);

    // detail
    this.detailEl = document.createElement("div");
    this.detailEl.style.cssText = "margin-top: 14px; padding: 12px; background: #111; border-radius: 6px;";
    panel.appendChild(this.detailEl);

    // export / import all
    const ioBar = document.createElement("div");
    ioBar.style.cssText = "display: flex; gap: 8px; margin-top: 14px;";
    const exportBtn = document.createElement("button");
    exportBtn.textContent = "Export all (.yaml)";
    exportBtn.style.cssText = "flex: 1; padding: 6px 10px; background: #333; color: #eee; border: 0; border-radius: 4px; cursor: pointer;";
    exportBtn.addEventListener("click", () => this.onExportAll());
    const importBtn = document.createElement("button");
    importBtn.textContent = "Import all (.yaml)";
    importBtn.style.cssText = "flex: 1; padding: 6px 10px; background: #333; color: #eee; border: 0; border-radius: 4px; cursor: pointer;";
    importBtn.addEventListener("click", () => this.onImportAll());
    ioBar.append(exportBtn, importBtn);
    panel.appendChild(ioBar);

    document.body.appendChild(this.root);
    window.addEventListener("keydown", this.onKeyDown);
    this.renderList();
  }

  show(): void {
    this.root.style.display = "block";
    this.renderList();
  }

  hide(): void {
    this.root.style.display = "none";
  }

  isVisible(): boolean {
    return this.root.style.display !== "none";
  }

  getActivePresetId(): string | null {
    return this.activeId;
  }

  setActivePresetId(id: string | null): void {
    this.activeId = id;
    if (this.isVisible()) this.renderList();
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    this.root.remove();
  }

  // ---------- 内部処理 ----------

  private renderList(): void {
    this.gridEl.replaceChildren();
    const items = this.store.list();
    if (items.length === 0) {
      const empty = document.createElement("div");
      empty.textContent = "(まだプリセットがありません。上の Save ボタンで登録できます)";
      empty.style.cssText = "color: #888; padding: 16px;";
      this.gridEl.appendChild(empty);
      this.renderDetail(null);
      return;
    }
    for (const p of items) {
      this.gridEl.appendChild(this.renderCard(p));
    }
    const active = this.activeId ? this.store.get(this.activeId) : null;
    this.renderDetail(active);
  }

  private renderCard(p: Preset): HTMLDivElement {
    const card = document.createElement("div");
    const isActive = this.activeId === p.id;
    card.style.cssText = `
      background: #222; border-radius: 6px; padding: 8px;
      cursor: pointer; user-select: none;
      outline: ${isActive ? "2px solid #5ac" : "1px solid #333"};
    `;
    const img = document.createElement("img");
    img.src = p.thumbnail;
    img.alt = p.name;
    img.style.cssText = "width: 100%; aspect-ratio: 16/9; object-fit: contain; background: #000; border-radius: 4px;";
    const name = document.createElement("div");
    name.textContent = p.name;
    name.style.cssText = "margin-top: 6px; font-weight: 500;";
    const desc = document.createElement("div");
    desc.textContent = p.description.split("\n")[0] ?? "";
    desc.style.cssText = "font-size: 11px; color: #aaa; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;";
    card.append(img, name, desc);
    card.addEventListener("click", () => {
      this.activeId = p.id;
      this.callbacks.onApply(p);
      this.renderList();
    });
    return card;
  }

  private renderDetail(p: Preset | null): void {
    this.detailEl.replaceChildren();
    if (!p) {
      this.detailEl.textContent = "(カードを選択すると編集できます)";
      this.detailEl.style.color = "#888";
      return;
    }
    this.detailEl.style.color = "#eee";
    const heading = document.createElement("div");
    heading.textContent = "Detail (選択中)";
    heading.style.cssText = "font-weight: 600; margin-bottom: 8px;";
    this.detailEl.appendChild(heading);

    const row = (label: string, input: HTMLElement) => {
      const wrap = document.createElement("label");
      wrap.style.cssText = "display: block; margin-bottom: 8px;";
      const span = document.createElement("span");
      span.textContent = label;
      span.style.cssText = "display: block; font-size: 11px; color: #aaa; margin-bottom: 2px;";
      wrap.append(span, input);
      this.detailEl.appendChild(wrap);
    };

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.value = p.name;
    nameInput.style.cssText = "width: 100%; padding: 4px 6px; background: #222; color: #eee; border: 1px solid #444; border-radius: 3px;";
    nameInput.addEventListener("input", () => {
      this.store.update(p.id, { name: nameInput.value });
      this.renderList();
    });
    row("name", nameInput);

    const descInput = document.createElement("textarea");
    descInput.value = p.description;
    descInput.rows = 2;
    descInput.style.cssText = "width: 100%; padding: 4px 6px; background: #222; color: #eee; border: 1px solid #444; border-radius: 3px; resize: vertical;";
    descInput.addEventListener("input", () => {
      this.store.update(p.id, { description: descInput.value });
      // テキストはカード側の 1 行プレビューにも反映するため再描画
      this.renderList();
    });
    row("description", descInput);

    const buttons = document.createElement("div");
    buttons.style.cssText = "display: flex; gap: 8px; margin-top: 6px;";

    const applyBtn = document.createElement("button");
    applyBtn.textContent = "apply";
    applyBtn.style.cssText = "padding: 6px 10px; background: #2a4a6a; color: #eee; border: 0; border-radius: 4px; cursor: pointer;";
    applyBtn.addEventListener("click", () => this.callbacks.onApply(p));

    const replaceBtn = document.createElement("button");
    replaceBtn.textContent = "replace thumb";
    replaceBtn.style.cssText = "padding: 6px 10px; background: #333; color: #eee; border: 0; border-radius: 4px; cursor: pointer;";
    replaceBtn.addEventListener("click", () => this.onReplaceThumb(p));

    const deleteBtn = document.createElement("button");
    deleteBtn.textContent = "delete";
    deleteBtn.style.cssText = "padding: 6px 10px; background: #4a2a2a; color: #eee; border: 0; border-radius: 4px; cursor: pointer; margin-left: auto;";
    deleteBtn.addEventListener("click", () => this.onDelete(p));

    buttons.append(applyBtn, replaceBtn, deleteBtn);
    this.detailEl.appendChild(buttons);
  }

  private onSaveCurrent(): void {
    const names = this.store.list().map((p) => p.name);
    const defaultName = nextDefaultPresetName(names);
    const name = window.prompt("preset name?", defaultName);
    if (name === null) return;
    let thumbnail = "";
    try {
      thumbnail = this.callbacks.captureThumbnail();
    } catch (e) {
      console.warn("[PresetManager] thumbnail capture failed:", e);
    }
    try {
      const p = this.store.add({
        name,
        description: "",
        thumbnail,
        settings: this.callbacks.getCurrentSettings(),
      });
      this.activeId = p.id;
      this.renderList();
    } catch (e) {
      window.alert("プリセットの保存に失敗しました: " + (e instanceof Error ? e.message : String(e)));
    }
  }

  private async onReplaceThumb(p: Preset): Promise<void> {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/webp";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const url = await imageToThumbnailDataURL(file);
        this.store.update(p.id, { thumbnail: url });
        this.renderList();
      } catch (e) {
        window.alert("画像の読み込みに失敗しました: " + (e instanceof Error ? e.message : String(e)));
      }
    });
    input.click();
  }

  private onDelete(p: Preset): void {
    if (!window.confirm(`プリセット "${p.name}" を削除します。よろしいですか?`)) return;
    this.store.remove(p.id);
    if (this.activeId === p.id) this.activeId = null;
    this.renderList();
  }

  private onExportAll(): void {
    const text = serializeBundleYaml(this.store.toBundle());
    const blob = new Blob([text], { type: "application/x-yaml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    a.download = `pose-particles-presets-${ts}.yaml`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  private onImportAll(): void {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".yaml,.yml,application/x-yaml,text/yaml";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const bundle = parseBundleYaml(text);
        this.store.fromBundle(bundle);
        this.activeId = null;
        this.renderList();
      } catch (e) {
        window.alert("プリセット一式の読み込みに失敗しました: " + (e instanceof Error ? e.message : String(e)));
      }
    });
    input.click();
  }
}
```

- [ ] **Step 8.2: 型 / 既存テストが壊れていないことを確認**

Run: `bun test`
Expected: 既存 + 新規がすべて PASS。型エラーが出れば直す (PresetManagerPanel 自体のテストは追加しない)。

- [ ] **Step 8.3: コミット**

```bash
git add src/pose-particles/ui/PresetManagerPanel.ts
git commit -m "#26 feat: PresetManagerPanel — 中央オーバーレイモーダル本体

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: SettingsPanel — applyPreset の image side-effects 対応

現状 `SettingsPanel.applyPreset` は image preset 変更時のサイド効果 (`onImageRequest` / `onImageRegridRequest`) を呼ばない。プリセット選択時に image preset が変わったら App 側に通知する必要があるため、`applyImageSideEffects` を `applyPreset` からも呼ぶ。

**Files:**
- Modify: `src/pose-particles/ui/SettingsPanel.ts`

- [ ] **Step 9.1: 修正**

`SettingsPanel.ts:210` 付近の `applyPreset` を以下に差し替える:

```ts
/** Replaces the live settings object's contents with another set, then refreshes the GUI. */
applyPreset(next: Settings, opts: { clearStorage?: boolean } = {}): void {
  const before = structuredClone(this.settings) as Settings;
  deepAssign(this.settings as unknown as Record<string, unknown>, next as unknown as Record<string, unknown>);
  this.gui.controllersRecursive().forEach((c) => c.updateDisplay());
  this.applyActivation();
  if (opts.clearStorage) clearSettings();
  else saveSettings(this.settings);
  // Issue #26: プリセット切替時に image preset / grid が変わったら App に通知する。
  // randomize / undoRandomize と同じパスを通す。
  this.applyImageSideEffects(before, this.settings);
}
```

- [ ] **Step 9.2: テスト確認**

Run: `bun test`
Expected: 全件 PASS (既存 randomize テストも影響なし)

- [ ] **Step 9.3: コミット**

```bash
git add src/pose-particles/ui/SettingsPanel.ts
git commit -m "#26 fix: SettingsPanel.applyPreset で image side-effects を発火

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: SettingsPanel — manage / next / random ボタン + callbacks

**Files:**
- Modify: `src/pose-particles/ui/SettingsPanel.ts`

- [ ] **Step 10.1: SettingsPanelCallbacks 拡張**

`SettingsPanel.ts:20` 付近の `SettingsPanelCallbacks` を以下に差し替え:

```ts
export interface SettingsPanelCallbacks {
  /** プリセット切替 / アップロード時に App へ通知 */
  onImageRequest?: (src: ImageSource) => void;
  /** gridW / gridH 変更時に App へ通知 (現在の画像で再サンプリング) */
  onImageRegridRequest?: () => void;
  /** Issue #26: プリセット管理モーダルを開く */
  onOpenPresetManager?: () => void;
  /** Issue #26: 次のプリセットへ即時切替 */
  onNextPreset?: () => void;
  /** Issue #26: ランダムなプリセットへ即時切替 */
  onRandomPreset?: () => void;
}
```

- [ ] **Step 10.2: Preset フォルダにボタンを追加**

`SettingsPanel.ts:171-188` 付近 (`const presets = system.addFolder("Preset");` のブロック) の末尾 (`this.undoController = presets.add(randomizeActions, "undo")...disable();` の直後) に追加:

```ts
// Issue #26: プリセット管理機能
const managerActions = {
  manage: () => callbacks.onOpenPresetManager?.(),
  next: () => callbacks.onNextPreset?.(),
  random: () => callbacks.onRandomPreset?.(),
};
presets.add(managerActions, "manage").name("manage presets…");
presets.add(managerActions, "next").name("next preset ▶");
presets.add(managerActions, "random").name("random preset");
```

- [ ] **Step 10.3: 既存テストが落ちていないことを確認**

Run: `bun test`
Expected: 既存 + 新規 すべて PASS

- [ ] **Step 10.4: コミット**

```bash
git add src/pose-particles/ui/SettingsPanel.ts
git commit -m "#26 feat: SettingsPanel に manage/next/random preset ボタンを追加

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: App.ts wiring

**Files:**
- Modify: `src/pose-particles/App.ts`

- [ ] **Step 11.1: import 追加**

`App.ts` 先頭の import 群 (既存 `import { SettingsPanel } from "./ui/SettingsPanel";` 付近) に追加:

```ts
import { PresetStore } from "./presets/PresetStore";
import { localStorageAdapter } from "./presets/storage";
import { captureThumbnail } from "./presets/thumbnail-capture";
import { PresetManagerPanel } from "./ui/PresetManagerPanel";
```

- [ ] **Step 11.2: フィールド追加**

App クラスのフィールド宣言 (`private settingsPanel: SettingsPanel;` 付近) に追加:

```ts
private presetStore: PresetStore;
private presetManager: PresetManagerPanel;
```

- [ ] **Step 11.3: constructor 内で生成 (順序に注意)**

`App.ts:128` 付近 — `this.settingsPanel = new SettingsPanel(...)` の **直前** に PresetStore / PresetManager を生成し、SettingsPanel 構築時に callbacks を渡せるようにする:

```ts
this.presetStore = new PresetStore(localStorageAdapter());
this.presetManager = new PresetManagerPanel(this.presetStore, {
  getCurrentSettings: () => structuredClone(this.settings),
  onApply: (preset) => {
    this.settingsPanel.applyPreset(preset.settings);
    this.presetManager.setActivePresetId(preset.id);
  },
  captureThumbnail: () => captureThumbnail(this.renderer, this.scene, this.camera),
});

this.settingsPanel = new SettingsPanel(this.settings, () => this.reanalyze(), {
  onImageRequest: (src) => this.loadImage(src),
  onImageRegridRequest: () => this.refreshImageGrid(),
  onOpenPresetManager: () => this.presetManager.show(),
  onNextPreset: () => {
    const p = this.presetStore.nextOf(this.presetManager.getActivePresetId());
    if (!p) return;
    this.settingsPanel.applyPreset(p.settings);
    this.presetManager.setActivePresetId(p.id);
  },
  onRandomPreset: () => {
    const p = this.presetStore.randomOf(this.presetManager.getActivePresetId());
    if (!p) return;
    this.settingsPanel.applyPreset(p.settings);
    this.presetManager.setActivePresetId(p.id);
  },
});
```

ただし、`onApply` の closure は `this.settingsPanel` を参照するが、`PresetManagerPanel` 生成時にはまだ `settingsPanel` は undefined である。これは callback 実行時 (= ユーザがクリックした時点) には初期化済みなので動作するが、TypeScript の strict mode で「Property 'settingsPanel' is used before being assigned」と出る場合は `this.settingsPanel!` と non-null assertion を付ける。または下記のように **PresetManagerPanel 生成を SettingsPanel 生成の後** に移動するのも可。

採用する順序:
```ts
// 1. SettingsPanel を先に生成 (presetManager callbacks にダミーを置く前提でも良いが、
//    SettingsPanel 側は onOpenPresetManager 等が undefined でも問題ない仕様)
this.settingsPanel = new SettingsPanel(this.settings, () => this.reanalyze(), {
  onImageRequest: (src) => this.loadImage(src),
  onImageRegridRequest: () => this.refreshImageGrid(),
  // 下の 3 callbacks は後で this.presetManager が生まれた後に動く必要がある。
  // 実際にユーザがボタンを押すのは構築完了後なので、closure で this.presetManager を
  // 参照するだけで OK。
  onOpenPresetManager: () => this.presetManager.show(),
  onNextPreset: () => {
    const p = this.presetStore.nextOf(this.presetManager.getActivePresetId());
    if (!p) return;
    this.settingsPanel.applyPreset(p.settings);
    this.presetManager.setActivePresetId(p.id);
  },
  onRandomPreset: () => {
    const p = this.presetStore.randomOf(this.presetManager.getActivePresetId());
    if (!p) return;
    this.settingsPanel.applyPreset(p.settings);
    this.presetManager.setActivePresetId(p.id);
  },
});

// 2. その後で PresetStore / PresetManager を生成
this.presetStore = new PresetStore(localStorageAdapter());
this.presetManager = new PresetManagerPanel(this.presetStore, {
  getCurrentSettings: () => structuredClone(this.settings),
  onApply: (preset) => {
    this.settingsPanel.applyPreset(preset.settings);
    this.presetManager.setActivePresetId(preset.id);
  },
  captureThumbnail: () => captureThumbnail(this.renderer, this.scene, this.camera),
});
```

この順序にすること。

- [ ] **Step 11.4: dispose() / hide() で破棄**

`App.ts:560` 付近の `this.settingsPanel.dispose();` の隣に追加:

```ts
this.presetManager.dispose();
```

`App.ts:217-227` 付近の `applyUiVisibility()` メソッドで `this.settingsPanel.setVisible(this.uiVisible);` の **直後** に以下 1 行を追加する。モーダル UI なので「H キーで全 UI 非表示」のときは強制 hide する:

```ts
private applyUiVisibility(): void {
  this.settingsPanel.setVisible(this.uiVisible);
  if (!this.uiVisible) this.presetManager.hide();   // ← 追加 (Issue #26)
  if (this.uiVisible && this.audioInput instanceof FileAudioSource && this.currentSeries !== null) {
    this.sectionTimeline.show();
  } else {
    this.sectionTimeline.hide();
  }
  const uiRoot = document.getElementById("ui-root");
  if (uiRoot) uiRoot.style.display = this.uiVisible ? "" : "none";
}
```

- [ ] **Step 11.5: 全テストが通っていることを確認 (型エラー含む)**

Run: `bun test`
Expected: 既存 + 新規 すべて PASS、型エラーなし

- [ ] **Step 11.6: コミット**

```bash
git add src/pose-particles/App.ts
git commit -m "#26 feat: App に PresetStore / PresetManagerPanel を wiring

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: 動作確認の準備とユーザ手動検証

- [ ] **Step 12.1: 全テストパスを再確認**

Run: `cd /Users/shun/dev/three-art/.worktrees/26-preset-manager && bun test`
Expected: 全件 PASS (既存 197 + 新規 38 〜)

- [ ] **Step 12.2: 起動 smoke (dev サーバ起動)**

ローカル起動コマンドを準備:

```bash
cd /Users/shun/dev/three-art/.worktrees/26-preset-manager && bun run dev
```

(実行はユーザ側。ブラウザで `http://localhost:3000/pose-particles.html` を開く)

- [ ] **Step 12.3: 手動 smoke checklist (ユーザに依頼)**

下記をユーザに確認してもらう:

| # | 操作 | 期待 |
|---|---|---|
| 1 | lil-gui の Preset フォルダを開く | "manage presets…" / "next preset ▶" / "random preset" ボタンが追加されている |
| 2 | "manage presets…" を押す | 中央にオーバーレイモーダルが出る。空状態メッセージ表示。 |
| 3 | 何か設定を変えて "Save current as preset" を押す | name 入力 prompt が出る → サムネ付きカードが追加される |
| 4 | 別の設定でもう 1 件 Save | 2 枚目のカードが並ぶ |
| 5 | カードをクリック | 即時に設定が切り替わり、選択枠ハイライトされる |
| 6 | Detail 欄で name / description を編集 | 入力後すぐカード表示も更新される |
| 7 | "replace thumb" でローカル画像を選ぶ | サムネが差し替わる |
| 8 | "delete" を押す | 確認 → カードが消える |
| 9 | "Export all (.yaml)" を押す | YAML がダウンロードされる |
| 10 | 全プリセット削除後、その YAML を "Import all" | プリセットが復元される |
| 11 | モーダルを閉じて lil-gui の "next preset ▶" を連打 | 登録順に切り替わり、末尾の次は先頭に戻る |
| 12 | "random preset" を連打 | ランダムに切り替わる (直前とは被らない、1 件しかなければそれ) |
| 13 | ブラウザリロード | プリセット一覧が保持される |
| 14 | 既存の "export preset (.yaml)" / "import preset (.yaml)" / "randomize" / "undo randomize" / "reset to defaults" | これまでどおり動く |

- [ ] **Step 12.4: 問題がなければ push & PR 作成**

```bash
git push -u origin feature/26-preset-manager
gh pr create --repo mishi5/three-art --base main \
  --title "#26 feat: pose-particles プリセット管理機能 (サムネ + 説明文 + 順番/ランダム適用)" \
  --body "$(cat <<'EOF'
## 概要

Issue #26 対応。pose-particles に「サムネ + 説明文付きプリセット」の登録/一覧/編集/削除、
YAML 一式 export-import、順番/ランダム適用ボタンを追加。

設計: \`docs/superpowers/specs/2026-05-21-pose-particles-preset-manager-design.md\`
プラン: \`docs/superpowers/plans/2026-05-21-pose-particles-preset-manager.md\`

## 主な変更

- \`src/pose-particles/presets/\` 新設 (types / PresetStore / storage / bundle-yaml / thumbnail-capture)
- \`src/pose-particles/ui/PresetManagerPanel.ts\` 新設 (中央オーバーレイモーダル)
- \`src/pose-particles/ui/preset-name.ts\` 新設 (採番ヘルパー)
- \`src/pose-particles/ui/SettingsPanel.ts\` の Preset フォルダに manage/next/random ボタン追加、applyPreset で image side-effects 発火
- \`src/pose-particles/App.ts\` に wiring 追加
- 既存単一 Settings の保存・export/import・auto-save は変更なし

## テスト

bun test 全件パス。Preset 系の純粋ロジック (Store / storage / bundle-yaml / thumbnail-capture / preset-name) は unit test、UI 本体は手動 smoke で確認。

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 12.5: マージ前コンフリクトチェック**

```bash
git fetch origin main
git merge --no-commit --no-ff origin/main || true
```

衝突があれば解消、なければ `git merge --abort` で中断して push 済みのままユーザ確認へ。

- [ ] **Step 12.6: ユーザに動作確認を依頼**

確認用 1 行:

```
cd /Users/shun/dev/three-art/.worktrees/26-preset-manager && bun run dev
```

ユーザ OK 後にマージ → Issue クローズ → worktree 後片付け (Git ルール 9–11)。

---

## 完了条件マッピング (Issue #26)

| Issue 完了条件 | 担当タスク |
|---|---|
| 登録 (名前/説明/自動サムネ) | Task 6, 7, 8 |
| 一覧サムネ付き選択 | Task 8 |
| 編集 (name/desc/サムネ差し替え)・削除 | Task 8 |
| localStorage 永続化 | Task 4 |
| YAML 一式 export/import | Task 5, 8 |
| 次へ・ランダム即時切替 | Task 3, 10, 11 |
| 既存 export/import・auto-save 不変 | Task 9 (側面通知の追加のみ、既存 key は不変) + smoke (Task 12.3 #14) |
| テスト全件パス | 各タスク末尾 + Task 12.1 |
