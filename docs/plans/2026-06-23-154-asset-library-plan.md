# #154 アセット管理 UI（永続アセットライブラリ）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** node-vj に画像/動画/音声を OPFS+IndexedDB で永続保存するアセットライブラリと、一覧パネル UI・D&D 割当・グラフ保存統合を追加する。

**Architecture:** ストレージを `BinaryStore`（バイナリ本体=OPFS）と `MetaStore`（メタ/サムネ=IndexedDB）の 2 アダプタに分離。`AssetLibrary` が両者を束ねる。ブラウザ依存 API（OPFS/IndexedDB/canvas/DnD）はユニットテストせず、純関数とメモリアダプタでロジックを覆い、本体は手動 / Playwright で確認する。ファイル入力ノードに `assetId` param を足し、`serialize.ts` round-trip で永続化・読込復元する。

**Tech Stack:** Bun + TypeScript + Three.js（React 不使用）。テスト: `bun run --cwd <wt> test`（`--isolate`）。WebCrypto(`crypto.subtle`)、OPFS(`navigator.storage.getDirectory`)、IndexedDB、HTML5 DnD。

- Issue: https://github.com/mishi5/three-art/issues/154
- Design: docs/plans/2026-06-23-154-asset-library-design.md

## Global Constraints

- コミットメッセージ先頭は `#154 <種別>: <説明>`、末尾に `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。
- テスト実行: `bun run --cwd /Users/shun/dev/three-art/.worktrees/154-asset-library test`（`bun test` 直叩き禁止）。
- 型チェック: `env -u NODE_OPTIONS bunx tsc --noEmit --project /Users/shun/dev/three-art/.worktrees/154-asset-library/tsconfig.json`。
- GLSL/THREE は触らない。新規ファイルは `src/apps/node-vj/asset/` 配下。
- ブラウザ依存 API は直接ユニットテストしない（純関数 + memory アダプタのみテスト）。
- ASCII/既存コードのスタイル（日本語コメント・2 space）に合わせる。

## File Structure

- `src/apps/node-vj/asset/asset-kind.ts` — mime → 種別判定（純関数）
- `src/apps/node-vj/asset/asset-id.ts` — File 内容ハッシュ（WebCrypto）
- `src/apps/node-vj/asset/thumbnail.ts` — サムネ寸法計算（純関数）+ 生成本体（DOM）
- `src/apps/node-vj/asset/binary-store.ts` — `BinaryStore` IF + memory/opfs 実装
- `src/apps/node-vj/asset/meta-store.ts` — `AssetMeta` 型 + `MetaStore` IF + memory/indexeddb 実装
- `src/apps/node-vj/asset/asset-library.ts` — 両ストアを束ねる中心クラス
- `src/apps/node-vj/asset/asset-refs.ts` — グラフから assetId 参照を抽出（純関数）
- `src/apps/node-vj/asset/asset-drop.ts` — drop 座標 → 対象ノード判定（純関数）
- `src/apps/node-vj/asset/asset-panel.ts` — HTML DOM パネル（DOM・手動確認）
- `src/apps/node-vj/nodes/{Image,Video,Audio}FileInputNode.ts` — `assetId` param 追加（Modify）
- `src/apps/node-vj/editor/NodeEditor.ts` — canvas drop 受け口追加（Modify）
- `src/apps/node-vj/main.ts` — library 生成・パネル配線・読込復元フック（Modify）

---

### Task 1: アセット種別判定（asset-kind）

**Files:**
- Create: `src/apps/node-vj/asset/asset-kind.ts`
- Test: `src/apps/node-vj/asset/asset-kind.test.ts`

**Interfaces:**
- Produces: `type AssetKind = "image" | "video" | "audio"`; `kindFromMime(mime: string): AssetKind | null`

- [ ] **Step 1: 失敗するテストを書く**

```ts
// asset-kind.test.ts
import { expect, test, describe } from "bun:test";
import { kindFromMime } from "./asset-kind";

describe("kindFromMime", () => {
  test("mime prefix で種別を判定", () => {
    expect(kindFromMime("image/png")).toBe("image");
    expect(kindFromMime("video/mp4")).toBe("video");
    expect(kindFromMime("audio/mpeg")).toBe("audio");
  });
  test("対象外/空は null", () => {
    expect(kindFromMime("application/json")).toBeNull();
    expect(kindFromMime("")).toBeNull();
  });
});
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `bun run --cwd /Users/shun/dev/three-art/.worktrees/154-asset-library test asset-kind`
Expected: FAIL（`kindFromMime` 未定義）

- [ ] **Step 3: 最小実装**

```ts
// asset-kind.ts
export type AssetKind = "image" | "video" | "audio";

/** MIME タイプの先頭から扱える種別を判定する。対象外は null。 */
export function kindFromMime(mime: string): AssetKind | null {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return null;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `bun run --cwd /Users/shun/dev/three-art/.worktrees/154-asset-library test asset-kind`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git -C /Users/shun/dev/three-art/.worktrees/154-asset-library add src/apps/node-vj/asset/asset-kind.ts src/apps/node-vj/asset/asset-kind.test.ts
git -C /Users/shun/dev/three-art/.worktrees/154-asset-library commit -m "$(printf '#154 feat: アセット種別判定 kindFromMime\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 2: File 内容ハッシュ（asset-id）

**Files:**
- Create: `src/apps/node-vj/asset/asset-id.ts`
- Test: `src/apps/node-vj/asset/asset-id.test.ts`

**Interfaces:**
- Produces: `hashBytes(bytes: ArrayBuffer): Promise<string>`（SHA-256 hex）; `hashFile(file: { arrayBuffer(): Promise<ArrayBuffer> }): Promise<string>`

- [ ] **Step 1: 失敗するテストを書く**

```ts
// asset-id.test.ts
import { expect, test, describe } from "bun:test";
import { hashBytes, hashFile } from "./asset-id";

describe("asset-id", () => {
  test("同一バイト列は同一ハッシュ・異なるバイト列は別ハッシュ", async () => {
    const a = await hashBytes(new Uint8Array([1, 2, 3]).buffer);
    const b = await hashBytes(new Uint8Array([1, 2, 3]).buffer);
    const c = await hashBytes(new Uint8Array([1, 2, 4]).buffer);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
  test("hashFile は arrayBuffer を読んでハッシュ化", async () => {
    const buf = new Uint8Array([9, 9, 9]).buffer;
    const file = { arrayBuffer: async () => buf };
    expect(await hashFile(file)).toBe(await hashBytes(buf));
  });
});
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `bun run --cwd /Users/shun/dev/three-art/.worktrees/154-asset-library test asset-id`
Expected: FAIL（未定義）

- [ ] **Step 3: 最小実装**

```ts
// asset-id.ts
/** SHA-256 を 16 進文字列で返す。アセット内容ハッシュ（重複排除 id）に使う。 */
export async function hashBytes(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** File（または arrayBuffer を持つもの）の内容ハッシュ。 */
export async function hashFile(file: { arrayBuffer(): Promise<ArrayBuffer> }): Promise<string> {
  return hashBytes(await file.arrayBuffer());
}
```

- [ ] **Step 4: テストが通ることを確認** — Run 同上 / Expected: PASS

- [ ] **Step 5: コミット**

```bash
git -C /Users/shun/dev/three-art/.worktrees/154-asset-library add src/apps/node-vj/asset/asset-id.ts src/apps/node-vj/asset/asset-id.test.ts
git -C /Users/shun/dev/three-art/.worktrees/154-asset-library commit -m "$(printf '#154 feat: アセット内容ハッシュ hashFile/hashBytes\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 3: サムネ寸法計算（thumbnail 純関数）

**Files:**
- Create: `src/apps/node-vj/asset/thumbnail.ts`
- Test: `src/apps/node-vj/asset/thumbnail.test.ts`

**Interfaces:**
- Produces: `fitThumbnailSize(srcW: number, srcH: number, maxW: number, maxH: number): { w: number; h: number }`（アスペクト維持・拡大しない・最小 1px）

- [ ] **Step 1: 失敗するテストを書く**

```ts
// thumbnail.test.ts
import { expect, test, describe } from "bun:test";
import { fitThumbnailSize } from "./thumbnail";

describe("fitThumbnailSize", () => {
  test("横長は幅に合わせて縮小", () => {
    expect(fitThumbnailSize(1920, 1080, 160, 120)).toEqual({ w: 160, h: 90 });
  });
  test("縦長は高さに合わせて縮小", () => {
    expect(fitThumbnailSize(1080, 1920, 160, 120)).toEqual({ w: 68, h: 120 });
  });
  test("元が小さい場合は拡大せずそのまま", () => {
    expect(fitThumbnailSize(80, 60, 160, 120)).toEqual({ w: 80, h: 60 });
  });
  test("0 や負値でも最小 1px を返す", () => {
    expect(fitThumbnailSize(0, 0, 160, 120)).toEqual({ w: 1, h: 1 });
  });
});
```

- [ ] **Step 2: テストが落ちることを確認** — Run: `... test thumbnail` / Expected: FAIL

- [ ] **Step 3: 最小実装**

```ts
// thumbnail.ts
/** アスペクト比を保ったまま max 矩形に収まる寸法を返す。拡大はしない。最小 1px。 */
export function fitThumbnailSize(srcW: number, srcH: number, maxW: number, maxH: number): { w: number; h: number } {
  if (srcW <= 0 || srcH <= 0) return { w: 1, h: 1 };
  const scale = Math.min(maxW / srcW, maxH / srcH, 1);
  return { w: Math.max(1, Math.round(srcW * scale)), h: Math.max(1, Math.round(srcH * scale)) };
}
```

- [ ] **Step 4: テストが通ることを確認** — Run 同上 / Expected: PASS

- [ ] **Step 5: 生成本体スタブを追記（テストなし・手動確認）**

`thumbnail.ts` に DOM 依存の生成関数を追記する。THUMB_MAX は 160×120。

```ts
import type { AssetKind } from "./asset-kind";

export const THUMB_W = 160;
export const THUMB_H = 120;

/** 種別別にサムネ Blob を生成する（DOM 依存・本番のみ）。失敗時は null。
 *  image=縮小描画 / video=0.1 秒地点の 1 フレーム / audio=null（パネル側でアイコン表示）。 */
export async function generateThumbnail(file: File, kind: AssetKind): Promise<Blob | null> {
  try {
    if (kind === "image") return await thumbFromImage(file);
    if (kind === "video") return await thumbFromVideo(file);
    return null; // audio はサムネなし（パネルでアイコン）
  } catch {
    return null;
  }
}

async function drawToBlob(src: CanvasImageSource, w: number, h: number): Promise<Blob | null> {
  const fit = fitThumbnailSize(w, h, THUMB_W, THUMB_H);
  const canvas = document.createElement("canvas");
  canvas.width = fit.w; canvas.height = fit.h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(src, 0, 0, fit.w, fit.h);
  return await new Promise((res) => canvas.toBlob((b) => res(b), "image/png"));
}

async function thumbFromImage(file: File): Promise<Blob | null> {
  const bmp = await createImageBitmap(file);
  try { return await drawToBlob(bmp, bmp.width, bmp.height); } finally { bmp.close(); }
}

async function thumbFromVideo(file: File): Promise<Blob | null> {
  const url = URL.createObjectURL(file);
  try {
    const v = document.createElement("video");
    v.muted = true; v.src = url;
    await new Promise<void>((res, rej) => { v.onloadeddata = () => res(); v.onerror = () => rej(new Error("video load")); });
    await new Promise<void>((res) => { v.onseeked = () => res(); v.currentTime = Math.min(0.1, v.duration || 0.1); });
    return await drawToBlob(v, v.videoWidth, v.videoHeight);
  } finally { URL.revokeObjectURL(url); }
}
```

- [ ] **Step 6: 型チェック + テスト全件**

Run: `env -u NODE_OPTIONS bunx tsc --noEmit --project /Users/shun/dev/three-art/.worktrees/154-asset-library/tsconfig.json`
Run: `bun run --cwd /Users/shun/dev/three-art/.worktrees/154-asset-library test`
Expected: 型エラーなし / 全 PASS

- [ ] **Step 7: コミット**

```bash
git -C /Users/shun/dev/three-art/.worktrees/154-asset-library add src/apps/node-vj/asset/thumbnail.ts src/apps/node-vj/asset/thumbnail.test.ts
git -C /Users/shun/dev/three-art/.worktrees/154-asset-library commit -m "$(printf '#154 feat: サムネ寸法計算 fitThumbnailSize + 生成本体\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 4: バイナリストア（BinaryStore: memory + opfs）

**Files:**
- Create: `src/apps/node-vj/asset/binary-store.ts`
- Test: `src/apps/node-vj/asset/binary-store.test.ts`

**Interfaces:**
- Produces:
  - `interface BinaryStore { put(id: string, blob: Blob): Promise<void>; getFile(id: string): Promise<File | null>; delete(id: string): Promise<void>; has(id: string): Promise<boolean>; }`
  - `memoryBinaryStore(): BinaryStore`（テスト用）
  - `opfsBinaryStore(dirName?: string): BinaryStore`（本番・DOM/OPFS 依存・手動確認）

- [ ] **Step 1: 失敗するテストを書く（memory アダプタのみ）**

```ts
// binary-store.test.ts
import { expect, test, describe } from "bun:test";
import { memoryBinaryStore } from "./binary-store";

describe("memoryBinaryStore", () => {
  test("put/getFile/has/delete の CRUD", async () => {
    const s = memoryBinaryStore();
    expect(await s.has("a")).toBe(false);
    await s.put("a", new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }));
    expect(await s.has("a")).toBe(true);
    const f = await s.getFile("a");
    expect(f).not.toBeNull();
    expect(await f!.arrayBuffer()).toEqual(new Uint8Array([1, 2, 3]).buffer);
    await s.delete("a");
    expect(await s.has("a")).toBe(false);
    expect(await s.getFile("a")).toBeNull();
  });
});
```

- [ ] **Step 2: テストが落ちることを確認** — Run: `... test binary-store` / Expected: FAIL

- [ ] **Step 3: 最小実装（memory + opfs）**

```ts
// binary-store.ts
/** アセットのバイナリ本体を保存するストア。本番は OPFS、テストは memory。 */
export interface BinaryStore {
  put(id: string, blob: Blob): Promise<void>;
  getFile(id: string): Promise<File | null>;
  delete(id: string): Promise<void>;
  has(id: string): Promise<boolean>;
}

/** メモリ上に Blob を保持するテスト用アダプタ。 */
export function memoryBinaryStore(): BinaryStore {
  const m = new Map<string, Blob>();
  return {
    async put(id, blob) { m.set(id, blob); },
    async getFile(id) { const b = m.get(id); return b ? new File([b], id, { type: b.type }) : null; },
    async delete(id) { m.delete(id); },
    async has(id) { return m.has(id); },
  };
}

/** OPFS にバイナリを保存する本番アダプタ（手動確認）。createWritable でストリーム書き込み。 */
export function opfsBinaryStore(dirName = "node-vj-assets"): BinaryStore {
  async function dir(): Promise<FileSystemDirectoryHandle> {
    const root = await navigator.storage.getDirectory();
    return await root.getDirectoryHandle(dirName, { create: true });
  }
  return {
    async put(id, blob) {
      const d = await dir();
      const fh = await d.getFileHandle(id, { create: true });
      const w = await fh.createWritable();
      await blob.stream().pipeTo(w);
    },
    async getFile(id) {
      try { const d = await dir(); const fh = await d.getFileHandle(id); return await fh.getFile(); }
      catch { return null; }
    },
    async delete(id) {
      try { const d = await dir(); await d.removeEntry(id); } catch { /* ない場合は無視 */ }
    },
    async has(id) {
      try { const d = await dir(); await d.getFileHandle(id); return true; } catch { return false; }
    },
  };
}
```

- [ ] **Step 4: テストが通ることを確認 + 型チェック** — Run: `... test binary-store` と tsc / Expected: PASS / 型エラーなし

- [ ] **Step 5: コミット**

```bash
git -C /Users/shun/dev/three-art/.worktrees/154-asset-library add src/apps/node-vj/asset/binary-store.ts src/apps/node-vj/asset/binary-store.test.ts
git -C /Users/shun/dev/three-art/.worktrees/154-asset-library commit -m "$(printf '#154 feat: BinaryStore（memory + OPFS アダプタ）\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 5: メタストア（MetaStore: memory + indexeddb）

**Files:**
- Create: `src/apps/node-vj/asset/meta-store.ts`
- Test: `src/apps/node-vj/asset/meta-store.test.ts`

**Interfaces:**
- Produces:
  - `interface AssetMeta { id: string; kind: AssetKind; fileName: string; mime: string; size: number; thumbnail: Blob | null; createdAt: number; }`
  - `interface MetaStore { list(): Promise<AssetMeta[]>; get(id): Promise<AssetMeta | null>; put(meta: AssetMeta): Promise<void>; delete(id): Promise<void>; }`
  - `memoryMetaStore(): MetaStore`、`indexedDbMetaStore(dbName?: string): MetaStore`

- [ ] **Step 1: 失敗するテストを書く（memory アダプタ）**

```ts
// meta-store.test.ts
import { expect, test, describe } from "bun:test";
import { memoryMetaStore, type AssetMeta } from "./meta-store";

function meta(id: string, createdAt: number): AssetMeta {
  return { id, kind: "image", fileName: id + ".png", mime: "image/png", size: 10, thumbnail: null, createdAt };
}

describe("memoryMetaStore", () => {
  test("put/get/list/delete・list は createdAt 昇順", async () => {
    const s = memoryMetaStore();
    expect(await s.list()).toEqual([]);
    await s.put(meta("b", 200));
    await s.put(meta("a", 100));
    expect((await s.list()).map((m) => m.id)).toEqual(["a", "b"]);
    expect((await s.get("a"))?.fileName).toBe("a.png");
    expect(await s.get("x")).toBeNull();
    await s.delete("a");
    expect((await s.list()).map((m) => m.id)).toEqual(["b"]);
  });
});
```

- [ ] **Step 2: テストが落ちることを確認** — Run: `... test meta-store` / Expected: FAIL

- [ ] **Step 3: 最小実装（memory + indexeddb）**

```ts
// meta-store.ts
import type { AssetKind } from "./asset-kind";

export interface AssetMeta {
  id: string;
  kind: AssetKind;
  fileName: string;
  mime: string;
  size: number;
  thumbnail: Blob | null;
  createdAt: number;
}

export interface MetaStore {
  list(): Promise<AssetMeta[]>;
  get(id: string): Promise<AssetMeta | null>;
  put(meta: AssetMeta): Promise<void>;
  delete(id: string): Promise<void>;
}

/** メモリ上に AssetMeta を保持するテスト用アダプタ。list は createdAt 昇順。 */
export function memoryMetaStore(): MetaStore {
  const m = new Map<string, AssetMeta>();
  return {
    async list() { return [...m.values()].sort((a, b) => a.createdAt - b.createdAt); },
    async get(id) { return m.get(id) ?? null; },
    async put(meta) { m.set(meta.id, meta); },
    async delete(id) { m.delete(id); },
  };
}

/** IndexedDB に AssetMeta を保存する本番アダプタ（手動確認）。 */
export function indexedDbMetaStore(dbName = "node-vj-assets"): MetaStore {
  const STORE = "meta";
  function open(): Promise<IDBDatabase> {
    return new Promise((res, rej) => {
      const req = indexedDB.open(dbName, 1);
      req.onupgradeneeded = () => { req.result.createObjectStore(STORE, { keyPath: "id" }); };
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  }
  async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await open();
    return new Promise<T>((res, rej) => {
      const r = fn(db.transaction(STORE, mode).objectStore(STORE));
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    }).finally(() => db.close());
  }
  return {
    async list() {
      const all = await tx<AssetMeta[]>("readonly", (s) => s.getAll() as IDBRequest<AssetMeta[]>);
      return all.sort((a, b) => a.createdAt - b.createdAt);
    },
    async get(id) { return (await tx<AssetMeta | undefined>("readonly", (s) => s.get(id))) ?? null; },
    async put(meta) { await tx("readwrite", (s) => s.put(meta)); },
    async delete(id) { await tx("readwrite", (s) => s.delete(id)); },
  };
}
```

- [ ] **Step 4: テストが通ることを確認 + 型チェック** — Run: `... test meta-store` と tsc / Expected: PASS / 型エラーなし

- [ ] **Step 5: コミット**

```bash
git -C /Users/shun/dev/three-art/.worktrees/154-asset-library add src/apps/node-vj/asset/meta-store.ts src/apps/node-vj/asset/meta-store.test.ts
git -C /Users/shun/dev/three-art/.worktrees/154-asset-library commit -m "$(printf '#154 feat: MetaStore（memory + IndexedDB アダプタ）\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 6: アセットライブラリ中心クラス（asset-library）

**Files:**
- Create: `src/apps/node-vj/asset/asset-library.ts`
- Test: `src/apps/node-vj/asset/asset-library.test.ts`

**Interfaces:**
- Consumes: `BinaryStore`, `MetaStore`, `AssetMeta`, `kindFromMime`, `hashFile`
- Produces:
  - `interface AssetLibraryDeps { binary: BinaryStore; meta: MetaStore; makeThumbnail?: (file: File, kind: AssetKind) => Promise<Blob | null>; now?: () => number; }`
  - `class AssetLibrary { constructor(deps: AssetLibraryDeps); add(file: File): Promise<AssetMeta | null>; remove(id): Promise<void>; list(): Promise<AssetMeta[]>; getFile(id): Promise<File | null>; onChange(cb: () => void): () => void; }`
  - `add` は kind 判定不能なら null。id=内容ハッシュで重複排除（既存なら再生成せず既存 meta を返す）。

- [ ] **Step 1: 失敗するテストを書く**

```ts
// asset-library.test.ts
import { expect, test, describe } from "bun:test";
import { AssetLibrary } from "./asset-library";
import { memoryBinaryStore } from "./binary-store";
import { memoryMetaStore } from "./meta-store";

function lib() {
  let t = 0;
  return new AssetLibrary({
    binary: memoryBinaryStore(),
    meta: memoryMetaStore(),
    makeThumbnail: async () => null,
    now: () => ++t,
  });
}
function file(name: string, type: string, bytes: number[]): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

describe("AssetLibrary", () => {
  test("add で meta 登録・getFile で本体取得", async () => {
    const l = lib();
    const m = await l.add(file("a.png", "image/png", [1, 2, 3]));
    expect(m).not.toBeNull();
    expect(m!.kind).toBe("image");
    expect((await l.list()).length).toBe(1);
    const f = await l.getFile(m!.id);
    expect(await f!.arrayBuffer()).toEqual(new Uint8Array([1, 2, 3]).buffer);
  });
  test("同一内容は重複排除（id 一致・件数 1）", async () => {
    const l = lib();
    const a = await l.add(file("a.png", "image/png", [1, 2, 3]));
    const b = await l.add(file("copy.png", "image/png", [1, 2, 3]));
    expect(b!.id).toBe(a!.id);
    expect((await l.list()).length).toBe(1);
  });
  test("対象外 mime は null・登録されない", async () => {
    const l = lib();
    expect(await l.add(file("x.json", "application/json", [1]))).toBeNull();
    expect((await l.list()).length).toBe(0);
  });
  test("remove で消える", async () => {
    const l = lib();
    const m = await l.add(file("a.png", "image/png", [1, 2, 3]));
    await l.remove(m!.id);
    expect((await l.list()).length).toBe(0);
    expect(await l.getFile(m!.id)).toBeNull();
  });
  test("onChange は add/remove で発火・解除できる", async () => {
    const l = lib();
    let n = 0;
    const off = l.onChange(() => { n++; });
    await l.add(file("a.png", "image/png", [1]));
    expect(n).toBe(1);
    off();
    await l.add(file("b.png", "image/png", [2]));
    expect(n).toBe(1);
  });
});
```

- [ ] **Step 2: テストが落ちることを確認** — Run: `... test asset-library` / Expected: FAIL

- [ ] **Step 3: 最小実装**

```ts
// asset-library.ts
import type { BinaryStore } from "./binary-store";
import type { MetaStore, AssetMeta } from "./meta-store";
import { kindFromMime, type AssetKind } from "./asset-kind";
import { hashFile } from "./asset-id";

export interface AssetLibraryDeps {
  binary: BinaryStore;
  meta: MetaStore;
  /** サムネ生成（DOM 依存）。テストでは null を返すスタブを注入。 */
  makeThumbnail?: (file: File, kind: AssetKind) => Promise<Blob | null>;
  now?: () => number;
}

/** OPFS(バイナリ) + IndexedDB(メタ) を束ねるアセットライブラリ。id=内容ハッシュで重複排除。 */
export class AssetLibrary {
  private listeners = new Set<() => void>();
  constructor(private readonly deps: AssetLibraryDeps) {}

  async add(file: File): Promise<AssetMeta | null> {
    const kind = kindFromMime(file.type);
    if (!kind) return null;
    const id = await hashFile(file);
    const existing = await this.deps.meta.get(id);
    if (existing) return existing;
    const thumbnail = this.deps.makeThumbnail ? await this.deps.makeThumbnail(file, kind) : null;
    const meta: AssetMeta = {
      id, kind, fileName: file.name, mime: file.type, size: file.size, thumbnail,
      createdAt: this.deps.now ? this.deps.now() : Date.now(),
    };
    await this.deps.binary.put(id, file);
    await this.deps.meta.put(meta);
    this.emit();
    return meta;
  }

  async remove(id: string): Promise<void> {
    await this.deps.meta.delete(id);
    await this.deps.binary.delete(id);
    this.emit();
  }

  list(): Promise<AssetMeta[]> { return this.deps.meta.list(); }
  getFile(id: string): Promise<File | null> { return this.deps.binary.getFile(id); }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }
  private emit(): void { for (const cb of this.listeners) cb(); }
}
```

> 注: `Date.now()` 直呼びは harness で禁止されるが、これは**ブラウザ実行コード**（テストは `now` を注入）。テスト内では `Date.now` を呼ばないので問題なし。

- [ ] **Step 4: テストが通ることを確認 + 型チェック** — Run: `... test asset-library` と tsc / Expected: PASS / 型エラーなし

- [ ] **Step 5: コミット**

```bash
git -C /Users/shun/dev/three-art/.worktrees/154-asset-library add src/apps/node-vj/asset/asset-library.ts src/apps/node-vj/asset/asset-library.test.ts
git -C /Users/shun/dev/three-art/.worktrees/154-asset-library commit -m "$(printf '#154 feat: AssetLibrary（両ストア束ね・重複排除・変更通知）\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 7: グラフ↔アセット参照（assetId param + serialize round-trip + asset-refs）

**Files:**
- Modify: `src/apps/node-vj/nodes/ImageFileInputNode.ts`、`VideoFileInputNode.ts`、`AudioFileInputNode.ts`（`params` に assetId 追加）
- Create: `src/apps/node-vj/asset/asset-refs.ts`
- Test: `src/apps/node-vj/asset/asset-refs.test.ts`、`src/apps/node-vj/graph/serialize.test.ts`（既存に round-trip ケース追加）

**Interfaces:**
- Consumes: `GraphDoc`, `NodeRegistry`
- Produces: `interface AssetRef { nodeId: string; assetId: string; }`; `collectAssetRefs(graph: GraphDoc): AssetRef[]`（各ノードの `params.assetId` が非空文字列のものを集める）

- [ ] **Step 1: 各ファイル入力ノードに assetId param を追加**

3 ノードの `params: []`（ImageFileInputNode.ts:79 等）を次に変更:

```ts
  params: [
    { id: "assetId", label: "asset", kind: "string", default: "", noInput: true,
      description: "割り当てられたアセットの id（アセットライブラリ管理・UI 非表示）。" },
  ],
```

VideoFileInputNode / AudioFileInputNode に既存 params があれば末尾に同じ assetId 要素を足す（既存 param は消さない）。

- [ ] **Step 2: asset-refs の失敗テストを書く**

```ts
// asset-refs.test.ts
import { expect, test, describe } from "bun:test";
import { collectAssetRefs } from "./asset-refs";
import type { GraphDoc } from "../graph/graph-doc";

const graph: GraphDoc = {
  version: 1,
  nodes: [
    { id: "img", type: "ImageFileInput", params: { assetId: "h1" }, position: { x: 0, y: 0 } },
    { id: "vid", type: "VideoFileInput", params: { assetId: "" }, position: { x: 0, y: 0 } },
    { id: "num", type: "Number", params: { value: 1 }, position: { x: 0, y: 0 } },
  ],
  connections: [],
};

describe("collectAssetRefs", () => {
  test("assetId が非空のノードだけ集める", () => {
    expect(collectAssetRefs(graph)).toEqual([{ nodeId: "img", assetId: "h1" }]);
  });
});
```

- [ ] **Step 3: テストが落ちることを確認** — Run: `... test asset-refs` / Expected: FAIL

- [ ] **Step 4: asset-refs 実装**

```ts
// asset-refs.ts
import type { GraphDoc } from "../graph/graph-doc";

export interface AssetRef { nodeId: string; assetId: string; }

/** グラフ内の各ノードの params.assetId（非空文字列）を参照として集める。読込時の復元に使う。 */
export function collectAssetRefs(graph: GraphDoc): AssetRef[] {
  const refs: AssetRef[] = [];
  for (const n of graph.nodes) {
    const v = (n.params as Record<string, unknown> | undefined)?.assetId;
    if (typeof v === "string" && v !== "") refs.push({ nodeId: n.id, assetId: v });
  }
  return refs;
}
```

- [ ] **Step 5: serialize round-trip テストを追加**

`serialize.test.ts` に、ImageFileInput を含むグラフを serialize→deserialize して `params.assetId` が保持されることを検証するケースを追加する（既存テストの import/registry セットアップに倣う）。

```ts
test("#154 assetId param が round-trip で保持される", () => {
  const reg = createDefaultRegistry();
  const g = createGraph();
  addNode(g, { id: "img", type: "ImageFileInput", params: { assetId: "abc123" }, position: { x: 10, y: 20 } });
  const { doc } = deserializeGraph(serializeGraph(g), reg);
  const img = doc.nodes.find((n) => n.id === "img");
  expect(img?.params.assetId).toBe("abc123");
});
```

（`createDefaultRegistry` / `createGraph` / `addNode` / `serializeGraph` / `deserializeGraph` の import パスは既存テストファイルの先頭に合わせる。`deserializeGraph` の戻り値の形は既存テストを参照。）

- [ ] **Step 6: テスト・型チェック全件** — Run: `... test` と tsc / Expected: 全 PASS（既存含む）/ 型エラーなし

- [ ] **Step 7: コミット**

```bash
git -C /Users/shun/dev/three-art/.worktrees/154-asset-library add src/apps/node-vj/asset/asset-refs.ts src/apps/node-vj/asset/asset-refs.test.ts src/apps/node-vj/nodes/ImageFileInputNode.ts src/apps/node-vj/nodes/VideoFileInputNode.ts src/apps/node-vj/nodes/AudioFileInputNode.ts src/apps/node-vj/graph/serialize.test.ts
git -C /Users/shun/dev/three-art/.worktrees/154-asset-library commit -m "$(printf '#154 feat: assetId param + 参照抽出 collectAssetRefs（保存統合）\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 8: D&D 割当判定（asset-drop 純関数）

**Files:**
- Create: `src/apps/node-vj/asset/asset-drop.ts`
- Test: `src/apps/node-vj/asset/asset-drop.test.ts`

**Interfaces:**
- Consumes: `GraphDoc`, `NodeRegistry`, `fileRowRect`（`editor/layout.ts`）
- Produces: `assetDropTarget(graph: GraphDoc, registry: NodeRegistry, x: number, y: number): string | null`（ワールド座標 x,y がいずれかのノードのファイル行矩形内ならその nodeId、なければ null）

> 実装前に `editor/layout.ts` の `fileRowRect(node, def)` のシグネチャと座標系（ワールド/スクリーン）を確認し、`hasFileRow`/`fileRowRect` を再利用する。layout のヘルパが未 export なら export する（既存利用箇所を壊さない）。

- [ ] **Step 1: 失敗するテストを書く**

```ts
// asset-drop.test.ts
import { expect, test, describe } from "bun:test";
import { assetDropTarget } from "./asset-drop";
import { createDefaultRegistry } from "../nodes/registry";
import { createGraph, addNode } from "../graph/graph-doc";

describe("assetDropTarget", () => {
  test("ファイル行矩形内ならノード id、外なら null", () => {
    const reg = createDefaultRegistry();
    const g = createGraph();
    addNode(g, { id: "img", type: "ImageFileInput", params: { assetId: "" }, position: { x: 100, y: 100 } });
    const def = reg.require("ImageFileInput");
    // layout.fileRowRect で実際のファイル行中心座標を求めてから内外を判定する
    const { fileRowRect } = require("../editor/layout");
    const r = fileRowRect(g.nodes[0], def);
    expect(assetDropTarget(g, reg, r.x + r.w / 2, r.y + r.h / 2)).toBe("img");
    expect(assetDropTarget(g, reg, r.x - 50, r.y - 50)).toBeNull();
  });
});
```

- [ ] **Step 2: テストが落ちることを確認** — Run: `... test asset-drop` / Expected: FAIL

- [ ] **Step 3: 実装**

```ts
// asset-drop.ts
import type { GraphDoc } from "../graph/graph-doc";
import type { NodeRegistry } from "../graph/node-type";
import { fileRowRect } from "../editor/layout";

/** ワールド座標 (x,y) が乗っているファイル行ノードの id を返す。割当 D&D の drop 先判定。 */
export function assetDropTarget(graph: GraphDoc, registry: NodeRegistry, x: number, y: number): string | null {
  for (const node of graph.nodes) {
    const def = registry.get(node.type);
    if (!def?.fileInput) continue;
    const r = fileRowRect(node, def);
    if (r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return node.id;
  }
  return null;
}
```

（`fileRowRect` の戻り値が `{x,y,w,h}|null`・座標系がワールドであることを Step 0 で確認済みの前提。スクリーン座標を取る場合は、呼び出し側でビューポート変換した座標を渡す方針にしてテストもそれに合わせる。）

- [ ] **Step 4: テスト・型チェック** — Run: `... test asset-drop` と tsc / Expected: PASS / 型エラーなし

- [ ] **Step 5: コミット**

```bash
git -C /Users/shun/dev/three-art/.worktrees/154-asset-library add src/apps/node-vj/asset/asset-drop.ts src/apps/node-vj/asset/asset-drop.test.ts src/apps/node-vj/editor/layout.ts
git -C /Users/shun/dev/three-art/.worktrees/154-asset-library commit -m "$(printf '#154 feat: D&D 割当判定 assetDropTarget\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 9: パネル UI・canvas drop・main 配線（DOM 統合・手動 / Playwright 確認）

**Files:**
- Create: `src/apps/node-vj/asset/asset-panel.ts`
- Modify: `src/apps/node-vj/editor/NodeEditor.ts`（canvas への `drop`/`dragover` リスナ + drop コールバック注入）
- Modify: `src/apps/node-vj/main.ts`（library 生成・パネル配線・読込復元フック・assetId 記録）

**Interfaces:**
- Consumes: `AssetLibrary`, `AssetMeta`, `assetDropTarget`, `collectAssetRefs`, `generateThumbnail`, `opfsBinaryStore`, `indexedDbMetaStore`
- Produces: `buildAssetPanel(library: AssetLibrary, opts?: { initialOpen?: boolean }): HTMLElement`（戻り値はパネルのルート要素。内部に開閉トグルを内包する）

> DOM/OPFS/IndexedDB/DnD はユニットテストしない。ここはロジック層（Task 1–8）を配線するだけ。動作は Playwright スモーク + 手動で確認する。

- [ ] **Step 1: asset-panel.ts を実装（開閉トグル付きサイドパネル）**

`graph-io-bar.ts` のスタイルに倣い、画面端（左 or 右）の固定サイドパネルを作る。**表示／非表示を切り替えられること**:
- 常時表示の小さな**トグルボタン**（例: 📦 アセット）を画面隅に固定。クリックでパネル本体の `display`（`flex`⇄`none`）を切り替える。`open` 状態をモジュール内変数で保持（初期値は `opts.initialOpen ?? true`）。開閉状態は localStorage（キー `node-vj.asset-panel.open`）にも保存し、リロード後も維持する。
- パネル本体（一覧コンテナ + 追加ボタン + 使用量表示）。ヘッダに「アセット」見出しと閉じる（×）ボタンを置き、× でも非表示にできる。
- 一覧: 各アセットを `div(draggable=true)` で並べる。サムネ（`thumbnail` Blob を ObjectURL 化、無ければ種別アイコン 🎬/🖼/🎵）+ ファイル名 + サイズ + 削除ボタン。
- `dragstart` で `e.dataTransfer.setData("application/x-node-vj-asset", meta.id)`。
- 追加ボタン: `input[type=file][multiple]` を生成し、選択ファイルを `library.add` でループ追加。
- OS からのファイル D&D: パネルの `dragover`/`drop` で `e.dataTransfer.files` を `library.add`。
- `library.onChange` を購読して一覧を再描画。`navigator.storage.estimate()` で使用量を表示。
- クォータ超過（add の reject に `QuotaExceededError`）を catch してトースト表示。

> 開閉ロジック（`open` の真偽 → display 文字列）は純関数 `panelDisplay(open: boolean): "flex" | "none"` に切り出し、`asset-panel.test.ts` でテストする（DOM 本体はテストしない）。

- [ ] **Step 2: NodeEditor に canvas drop 受け口を追加**

コンストラクタ引数（または setter）で `onDropAsset?: (assetId: string, worldX: number, worldY: number) => void` を受け取り、canvas に:
```ts
canvas.addEventListener("dragover", (e) => { e.preventDefault(); });
canvas.addEventListener("drop", (e) => {
  const id = e.dataTransfer?.getData("application/x-node-vj-asset");
  if (!id) return;
  e.preventDefault();
  const { x, y } = this.screenToWorld(e.offsetX, e.offsetY); // 既存のビューポート変換を利用
  this.onDropAsset?.(id, x, y);
});
```
（`screenToWorld` 相当の既存変換メソッド名は `editor/viewport.ts` / NodeEditor 内を確認して合わせる。）

- [ ] **Step 3: main.ts を配線**

```ts
import { AssetLibrary } from "./asset/asset-library";
import { opfsBinaryStore } from "./asset/binary-store";
import { indexedDbMetaStore } from "./asset/meta-store";
import { generateThumbnail } from "./asset/thumbnail";
import { buildAssetPanel } from "./asset/asset-panel";
import { assetDropTarget } from "./asset/asset-drop";
import { collectAssetRefs } from "./asset/asset-refs";

const library = new AssetLibrary({
  binary: opfsBinaryStore(),
  meta: indexedDbMetaStore(),
  makeThumbnail: generateThumbnail,
});
buildAssetPanel(library, {});

// canvas drop → ファイル行ノードへ割当
editor.onDropAsset = async (assetId, x, y) => {
  const nodeId = assetDropTarget(graph, registry, x, y);
  if (!nodeId) return;
  const file = await library.getFile(assetId);
  if (!file) return;
  runtime.resumeAudio();
  const s = runtime.getState(nodeId) as { loadFile?: (f: File) => Promise<void> } | undefined;
  await s?.loadFile?.(file);
  const node = graph.nodes.find((n) => n.id === nodeId);
  if (node) (node.params as Record<string, unknown>).assetId = assetId; // 保存対象に記録
};

// グラフ読込後の復元: collectAssetRefs で各ノードへ loadFile
async function restoreAssets(): Promise<void> {
  for (const ref of collectAssetRefs(graph)) {
    const file = await library.getFile(ref.assetId);
    if (!file) { console.warn(`[node-vj] asset not found: ${ref.assetId}`); continue; }
    const s = runtime.getState(ref.nodeId) as { loadFile?: (f: File) => Promise<void> } | undefined;
    await s?.loadFile?.(file).catch((e) => console.warn(`[node-vj] restore failed ${ref.nodeId}:`, e));
  }
}
```
- 既存のファイルダイアログ割当（main.ts:102-106 の loadFileIntoNode）でも、選択ファイルを `library.add` して得た id を `node.params.assetId` に記録するよう拡張する（ライブラリ未経由の直接選択もライブラリに入る）。
- グラフ読込（graph-io-bar の読込ハンドラ後）に `restoreAssets()` を呼ぶフックを足す。読込導線が replaceGraph を使うため、読込完了イベント/コールバックの有無を確認して接続する。

- [ ] **Step 4: 型チェック・テスト全件**

Run: `env -u NODE_OPTIONS bunx tsc --noEmit --project /Users/shun/dev/three-art/.worktrees/154-asset-library/tsconfig.json`
Run: `bun run --cwd /Users/shun/dev/three-art/.worktrees/154-asset-library test`
Expected: 型エラーなし / 全 PASS

- [ ] **Step 5: コミット**

```bash
git -C /Users/shun/dev/three-art/.worktrees/154-asset-library add src/apps/node-vj/asset/asset-panel.ts src/apps/node-vj/editor/NodeEditor.ts src/apps/node-vj/main.ts
git -C /Users/shun/dev/three-art/.worktrees/154-asset-library commit -m "$(printf '#154 feat: アセットパネル UI・canvas D&D 割当・読込復元配線\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 10: ビルド確認 + Playwright スモーク + 手動確認準備

**Files:** なし（検証のみ）

- [ ] **Step 1: ビルド確認**

Run: `bun build /Users/shun/dev/three-art/.worktrees/154-asset-library/pose-particles.html /Users/shun/dev/three-art/.worktrees/154-asset-library/node-vj.html --outdir /tmp/154-build --minify`
Expected: エラーなし

- [ ] **Step 2: Playwright スモーク（パネル表示・OPFS/IndexedDB 例外なし）**

`lsof -ti tcp:3000 | xargs kill -9`（単独実行）後、with_server で node-vj を起動し、アセットパネル DOM が表示され console エラーが出ないことを確認（swiftshader 起動オプション使用）。実ファイル D&D・実再生は手動確認に委ねる。

- [ ] **Step 3: 手動確認手順をユーザへ提示**（1 コードブロック）

```
lsof -ti tcp:3000 | xargs kill -9
bun run --cwd /Users/shun/dev/three-art/.worktrees/154-asset-library dev:vj
```
確認項目: ①パネルに画像/動画/音声を D&D 追加 → 一覧・サムネ表示 ②パネルのアセットをノードのファイル行へ D&D → 反映 ③グラフ保存→リロード→読込で自動復元 ④削除 ⑤使用量表示。

---

## Self-Review

- **Spec coverage:** 一覧表示=Task9 / サムネ=Task3,9 / D&D 割当=Task8,9 / 永続化=Task4,5 / 全種別=Task1 / 保存統合=Task7,9 / 容量管理(手動削除・estimate・超過警告)=Task9。全項目にタスク対応あり。
- **Placeholder scan:** 各コードステップに実コードあり。Task9 の DOM 部分は手順記述（DOM/DnD はテスト対象外の方針上、骨子 + 既存パターン参照で妥当）。
- **Type consistency:** `AssetMeta`/`BinaryStore`/`MetaStore`/`AssetLibrary`/`collectAssetRefs`/`assetDropTarget` のシグネチャは Task 間で一貫。`fileRowRect`/`screenToWorld` は実装前に既存シグネチャ確認の注記あり。
- **要確認（実装時）:** `editor/layout.ts` の `fileRowRect` 座標系・export、NodeEditor の screen→world 変換メソッド名、graph-io-bar 読込完了フック。いずれも Task8/9 内に確認注記済み。
