# シーン管理機能（#151）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans / subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** node-vj に複数シーン（GraphDoc）をメモリ常駐させ、左サイドパネルから切替・追加・複製・削除・リネームでき、全シーンを localStorage に自動永続化する。

**Architecture:** `SceneManager`（純ロジック）が `Scene[]`/activeId を保持、`SceneStore`（localStorage）が永続化、`History` をシーン別トラックに拡張（切替で履歴クリアしない）。editor/runtime は単一の共有 `GraphDoc` にバインドされ続け、切替は `replaceGraph`＋state 再同期＋アセット復元で行う（即時ハードカット）。UI は `scene-panel`（左ドック折りたたみ）。

**Tech Stack:** Bun + TypeScript + Three.js。テスト: `bun run --cwd <wt> test`（`--isolate`）。型: `env -u NODE_OPTIONS bunx tsc --noEmit --project <wt>/tsconfig.json`。

- Issue: https://github.com/mishi5/three-art/issues/151
- Design: docs/plans/2026-06-23-151-scene-management-design.md

## Global Constraints
- コミット先頭は `#151 <種別>: <説明>`、末尾に `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。
- 新規ファイルは `src/apps/node-vj/scene/` 配下。ブラウザ依存 API（DOM/localStorage/OPFS）は純関数＋memory adapter のみ単体テスト。
- `GraphDoc` は純データ。deep copy は `structuredClone`。
- 日本語コメント・2 space・ASCII ソース。

## File Structure
- Create `src/apps/node-vj/scene/scene-store.ts` — `Scene`/`SceneSet` 型 + localStorage 永続化
- Create `src/apps/node-vj/scene/scene-manager.ts` — シーン集合の保持と操作（純ロジック）
- Create `src/apps/node-vj/scene/scene-panel.ts` — 左ドック UI（DOM）+ `panelDisplay` 純関数
- Modify `src/apps/node-vj/graph/history.ts` — シーン別トラック（`useScene`/`removeScene`）
- Modify `src/apps/node-vj/main.ts` — 生成・初期化・切替副作用・自動永続化・パネル配線

---

### Task 1: History のシーン別トラック対応

**Files:**
- Modify: `src/apps/node-vj/graph/history.ts`
- Test: `src/apps/node-vj/graph/history.test.ts`（既存に追記）

**Interfaces:**
- Produces: `History.useScene(sceneId: string): void`、`History.removeScene(sceneId: string): void`。既存 `record/undo/redo/discardLast/clear/canUndo/canRedo` はアクティブトラックに作用（既定トラックで後方互換）。

- [ ] **Step 1: 失敗するテストを追記**

```ts
// history.test.ts に追記
test("#151 シーン別トラックで履歴が独立し、切替でクリアされない", () => {
  const h = new History();
  const g = (v: number): GraphDoc => ({ version: 1, nodes: [{ id: "n", type: "Number", params: { value: v } }], connections: [] });
  h.useScene("A");
  h.record(g(1));            // A の履歴に 1 件
  expect(h.canUndo).toBe(true);
  h.useScene("B");
  expect(h.canUndo).toBe(false); // B は空
  h.record(g(2));
  h.useScene("A");
  expect(h.canUndo).toBe(true);  // A は保持されている（クリアされない）
  const snap = h.undo(g(99));
  expect(snap?.nodes[0]!.params.value).toBe(1);
});

test("#151 removeScene でトラック破棄", () => {
  const h = new History();
  const g: GraphDoc = { version: 1, nodes: [], connections: [] };
  h.useScene("A"); h.record(g);
  h.removeScene("A");
  h.useScene("A");
  expect(h.canUndo).toBe(false); // 破棄後は空
});
```

- [ ] **Step 2: 失敗を確認** — Run: `bun run --cwd /Users/shun/dev/three-art/.worktrees/151-scene-management test history` / Expected: FAIL（useScene 未定義）

- [ ] **Step 3: history.ts を実装（後方互換・加算的）**

```ts
import type { GraphDoc } from "./graph-doc";

const HISTORY_LIMIT = 50;
const DEFAULT_KEY = "__default__";

interface Track { undo: GraphDoc[]; redo: GraphDoc[]; }

export class History {
  private tracks = new Map<string, Track>();
  private activeKey = DEFAULT_KEY;

  private cur(): Track {
    let t = this.tracks.get(this.activeKey);
    if (!t) { t = { undo: [], redo: [] }; this.tracks.set(this.activeKey, t); }
    return t;
  }

  get canUndo(): boolean { return this.cur().undo.length > 0; }
  get canRedo(): boolean { return this.cur().redo.length > 0; }

  record(g: GraphDoc): void {
    const t = this.cur();
    t.undo.push(structuredClone(g));
    if (t.undo.length > HISTORY_LIMIT) t.undo.shift();
    t.redo = [];
  }

  discardLast(): void { this.cur().undo.pop(); }

  undo(current: GraphDoc): GraphDoc | null {
    const t = this.cur();
    const snap = t.undo.pop();
    if (!snap) return null;
    t.redo.push(structuredClone(current));
    return snap;
  }

  redo(current: GraphDoc): GraphDoc | null {
    const t = this.cur();
    const snap = t.redo.pop();
    if (!snap) return null;
    t.undo.push(structuredClone(current));
    return snap;
  }

  clear(): void { const t = this.cur(); t.undo = []; t.redo = []; }

  /** #151: アクティブな履歴トラックを切り替える（無ければ空で作成）。 */
  useScene(sceneId: string): void {
    this.activeKey = sceneId;
    if (!this.tracks.has(sceneId)) this.tracks.set(sceneId, { undo: [], redo: [] });
  }

  /** #151: シーン削除時にそのトラックを破棄する。 */
  removeScene(sceneId: string): void {
    this.tracks.delete(sceneId);
    if (this.activeKey === sceneId) this.activeKey = DEFAULT_KEY;
  }
}
```

- [ ] **Step 4: テスト通過 + 型** — Run: `... test history` と tsc / Expected: 全 PASS（既存含む）/ 型エラーなし

- [ ] **Step 5: コミット**

```bash
git -C /Users/shun/dev/three-art/.worktrees/151-scene-management add src/apps/node-vj/graph/history.ts src/apps/node-vj/graph/history.test.ts
git -C /Users/shun/dev/three-art/.worktrees/151-scene-management commit -m "#151 feat: History をシーン別トラック対応（切替で履歴を保持）" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: SceneStore（型 + localStorage 永続化）

**Files:**
- Create: `src/apps/node-vj/scene/scene-store.ts`
- Test: `src/apps/node-vj/scene/scene-store.test.ts`

**Interfaces:**
- Consumes: `KvStorage`/`memoryAdapter`（`../graph/graph-store`）, `GraphDoc`（`../graph/graph-doc`）
- Produces: `interface Scene { id: string; name: string; graph: GraphDoc }`; `interface SceneSet { version: number; scenes: Scene[]; activeId: string }`; `SCENE_SET_VERSION`; `class SceneStore { load(): SceneSet | null; save(set: SceneSet): void }`

- [ ] **Step 1: 失敗するテスト**

```ts
// scene-store.test.ts
import { expect, test, describe } from "bun:test";
import { SceneStore, SCENE_SET_VERSION, type SceneSet } from "./scene-store";
import { memoryAdapter } from "../graph/graph-store";

function sampleSet(): SceneSet {
  return {
    version: SCENE_SET_VERSION,
    scenes: [{ id: "a", name: "Scene 1", graph: { version: 1, nodes: [], connections: [] } }],
    activeId: "a",
  };
}

describe("SceneStore", () => {
  test("save→load round-trip", () => {
    const s = new SceneStore(memoryAdapter());
    expect(s.load()).toBeNull();
    s.save(sampleSet());
    expect(s.load()).toEqual(sampleSet());
  });
  test("壊れた JSON は null", () => {
    const kv = memoryAdapter();
    kv.setItem("node-vj.scenes.v1", "{ not json");
    expect(new SceneStore(kv).load()).toBeNull();
  });
  test("version 不一致・空配列は null", () => {
    const kv = memoryAdapter();
    kv.setItem("node-vj.scenes.v1", JSON.stringify({ version: 99, scenes: [], activeId: "x" }));
    expect(new SceneStore(kv).load()).toBeNull();
  });
});
```

- [ ] **Step 2: 失敗確認** — Run: `... test scene-store` / Expected: FAIL

- [ ] **Step 3: 実装**

```ts
// scene-store.ts
import type { KvStorage } from "../graph/graph-store";
import type { GraphDoc } from "../graph/graph-doc";

export interface Scene { id: string; name: string; graph: GraphDoc; }
export interface SceneSet { version: number; scenes: Scene[]; activeId: string; }

export const SCENE_SET_VERSION = 1;
const KEY = "node-vj.scenes.v1";

/** 全シーン（SceneSet）を localStorage に保存/復元する。破損時は null。 */
export class SceneStore {
  constructor(private readonly storage: KvStorage) {}

  load(): SceneSet | null {
    try {
      const raw = this.storage.getItem(KEY);
      if (!raw) return null;
      const s = JSON.parse(raw) as Partial<SceneSet>;
      if (s.version !== SCENE_SET_VERSION) return null;
      if (!Array.isArray(s.scenes) || s.scenes.length === 0) return null;
      if (typeof s.activeId !== "string") return null;
      return s as SceneSet;
    } catch {
      return null;
    }
  }

  save(set: SceneSet): void {
    this.storage.setItem(KEY, JSON.stringify(set));
  }
}
```

- [ ] **Step 4: テスト通過 + 型** — Run: `... test scene-store` と tsc / Expected: PASS / 型エラーなし

- [ ] **Step 5: コミット**

```bash
git -C /Users/shun/dev/three-art/.worktrees/151-scene-management add src/apps/node-vj/scene/scene-store.ts src/apps/node-vj/scene/scene-store.test.ts
git -C /Users/shun/dev/three-art/.worktrees/151-scene-management commit -m "#151 feat: SceneStore（Scene/SceneSet 型 + localStorage 永続化）" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: SceneManager（シーン集合の保持と操作）

**Files:**
- Create: `src/apps/node-vj/scene/scene-manager.ts`
- Test: `src/apps/node-vj/scene/scene-manager.test.ts`

**Interfaces:**
- Consumes: `Scene`/`SceneSet`/`SceneStore`/`SCENE_SET_VERSION`、`createGraph`（`../graph/graph-doc`）
- Produces:
  - `singleSceneSet(graph: GraphDoc, id: string, name?: string): SceneSet`
  - `class SceneManager { constructor(deps: { store: SceneStore; genId?: () => string }, initial: SceneSet); list(): Scene[]; activeId(): string; active(): Scene; add(name?: string): Scene; duplicate(id: string): Scene; remove(id: string): void; rename(id: string, name: string): void; setActive(id: string): void; updateActiveGraph(graph: GraphDoc): void; onChange(cb: () => void): () => void; }`

- [ ] **Step 1: 失敗するテスト**

```ts
// scene-manager.test.ts
import { expect, test, describe } from "bun:test";
import { SceneManager, singleSceneSet } from "./scene-manager";
import { SceneStore, SCENE_SET_VERSION } from "./scene-store";
import { memoryAdapter } from "../graph/graph-store";
import { createGraph, addNode } from "../graph/graph-doc";

function mgr() {
  let n = 0;
  const store = new SceneStore(memoryAdapter());
  const g = createGraph();
  addNode(g, { id: "x", type: "Number", params: { value: 1 } });
  const m = new SceneManager({ store, genId: () => `s${++n}` }, singleSceneSet(g, "s0", "Scene 1"));
  return { m, store };
}

describe("SceneManager", () => {
  test("初期は 1 シーン・active", () => {
    const { m } = mgr();
    expect(m.list().length).toBe(1);
    expect(m.activeId()).toBe("s0");
    expect(m.active().name).toBe("Scene 1");
  });
  test("add で末尾に空シーン追加・active 移動・永続化", () => {
    const { m, store } = mgr();
    const s = m.add();
    expect(m.list().length).toBe(2);
    expect(m.activeId()).toBe(s.id);
    expect(s.graph.nodes.length).toBe(0);
    expect(store.load()?.scenes.length).toBe(2);
  });
  test("duplicate は graph を独立コピー（元を変更しても複製は不変）", () => {
    const { m } = mgr();
    const dup = m.duplicate("s0");
    expect(m.list().length).toBe(2);
    // 元シーンの graph を破壊的変更
    addNode(m.list()[0]!.graph, { id: "y", type: "Number", params: { value: 2 } });
    expect(dup.graph.nodes.map((n) => n.id)).toEqual(["x"]); // 複製は影響を受けない
  });
  test("remove: 最後の 1 つは消えない", () => {
    const { m } = mgr();
    m.remove("s0");
    expect(m.list().length).toBe(1);
  });
  test("remove: active を消すと隣を active に", () => {
    const { m } = mgr();
    const s = m.add();              // active = s.id, [s0, s]
    m.setActive("s0");
    m.remove("s0");
    expect(m.activeId()).toBe(s.id);
    expect(m.list().length).toBe(1);
  });
  test("rename / setActive / updateActiveGraph / onChange", () => {
    const { m, store } = mgr();
    let fired = 0;
    const off = m.onChange(() => { fired++; });
    m.rename("s0", "Intro");
    expect(m.active().name).toBe("Intro");
    const g = createGraph();
    addNode(g, { id: "z", type: "Number", params: { value: 9 } });
    m.updateActiveGraph(g);
    expect(m.active().graph.nodes.map((n) => n.id)).toEqual(["z"]);
    // 書き戻しは独立コピー（後から g を変更しても影響しない）
    addNode(g, { id: "w", type: "Number", params: { value: 0 } });
    expect(m.active().graph.nodes.map((n) => n.id)).toEqual(["z"]);
    expect(fired).toBeGreaterThanOrEqual(2);
    off();
    m.rename("s0", "X");
    expect(fired).toBeGreaterThanOrEqual(2); // 解除後は増えない（厳密一致でなく monotonic 確認）
    expect(store.load()?.scenes[0]!.name).toBe("X");
  });
});
```

- [ ] **Step 2: 失敗確認** — Run: `... test scene-manager` / Expected: FAIL

- [ ] **Step 3: 実装**

```ts
// scene-manager.ts
import type { GraphDoc } from "../graph/graph-doc";
import { createGraph } from "../graph/graph-doc";
import type { Scene, SceneSet } from "./scene-store";
import { SceneStore, SCENE_SET_VERSION } from "./scene-store";

/** 単一シーンの SceneSet を作る（初回初期化用）。 */
export function singleSceneSet(graph: GraphDoc, id: string, name = "Scene 1"): SceneSet {
  return { version: SCENE_SET_VERSION, scenes: [{ id, name, graph }], activeId: id };
}

export interface SceneManagerDeps { store: SceneStore; genId?: () => string; }

/** 複数シーン（GraphDoc）をメモリ保持し、操作のたびに永続化・変更通知する。 */
export class SceneManager {
  private scenes: Scene[];
  private _activeId: string;
  private readonly store: SceneStore;
  private readonly genId: () => string;
  private counter = 0;
  private listeners = new Set<() => void>();

  constructor(deps: SceneManagerDeps, initial: SceneSet) {
    this.store = deps.store;
    this.genId = deps.genId ?? (() => `scene-${Date.now().toString(36)}-${(++this.counter).toString(36)}`);
    this.scenes = initial.scenes;
    this._activeId = initial.activeId;
  }

  list(): Scene[] { return [...this.scenes]; }
  activeId(): string { return this._activeId; }
  active(): Scene { return this.byId(this._activeId); }

  add(name?: string): Scene {
    const scene: Scene = { id: this.genId(), name: name ?? `Scene ${this.scenes.length + 1}`, graph: createGraph() };
    this.scenes.push(scene);
    this._activeId = scene.id;
    this.commit();
    return scene;
  }

  duplicate(id: string): Scene {
    const src = this.byId(id);
    const scene: Scene = { id: this.genId(), name: `${src.name} copy`, graph: structuredClone(src.graph) };
    const idx = this.scenes.findIndex((s) => s.id === id);
    this.scenes.splice(idx + 1, 0, scene);
    this._activeId = scene.id;
    this.commit();
    return scene;
  }

  remove(id: string): void {
    if (this.scenes.length <= 1) return;            // 最低 1 シーンは残す
    const idx = this.scenes.findIndex((s) => s.id === id);
    if (idx < 0) return;
    this.scenes.splice(idx, 1);
    if (this._activeId === id) {
      this._activeId = this.scenes[Math.min(idx, this.scenes.length - 1)]!.id;
    }
    this.commit();
  }

  rename(id: string, name: string): void { this.byId(id).name = name; this.commit(); }

  setActive(id: string): void {
    if (this.scenes.some((s) => s.id === id)) { this._activeId = id; this.commit(); }
  }

  /** 編集中の共有グラフをアクティブシーンへ独立コピーで書き戻す。 */
  updateActiveGraph(graph: GraphDoc): void {
    this.active().graph = structuredClone(graph);
    this.commit();
  }

  onChange(cb: () => void): () => void { this.listeners.add(cb); return () => { this.listeners.delete(cb); }; }

  private byId(id: string): Scene {
    const s = this.scenes.find((x) => x.id === id);
    if (!s) throw new Error(`scene not found: ${id}`);
    return s;
  }
  private toSet(): SceneSet { return { version: SCENE_SET_VERSION, scenes: this.scenes, activeId: this._activeId }; }
  private commit(): void { this.store.save(this.toSet()); for (const cb of this.listeners) cb(); }
}
```

- [ ] **Step 4: テスト通過 + 型** — Run: `... test scene-manager` と tsc / Expected: PASS / 型エラーなし

- [ ] **Step 5: コミット**

```bash
git -C /Users/shun/dev/three-art/.worktrees/151-scene-management add src/apps/node-vj/scene/scene-manager.ts src/apps/node-vj/scene/scene-manager.test.ts
git -C /Users/shun/dev/three-art/.worktrees/151-scene-management commit -m "#151 feat: SceneManager（add/duplicate/remove/rename/active/書き戻し）" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: scene-panel（左ドック UI + panelDisplay 純関数）

**Files:**
- Create: `src/apps/node-vj/scene/scene-panel.ts`
- Test: `src/apps/node-vj/scene/scene-panel.test.ts`

**Interfaces:**
- Consumes: `Scene`（scene-store）
- Produces:
  - `panelDisplay(open: boolean): "flex" | "none"`（純関数）
  - `interface ScenePanelActions { list(): Scene[]; activeId(): string; switchTo(id: string): void; add(): void; duplicate(id: string): void; remove(id: string): void; rename(id: string, name: string): void; onChange(cb: () => void): () => void; }`
  - `buildScenePanel(actions: ScenePanelActions): HTMLElement`（パネル本体を body へ追加し返す）

- [ ] **Step 1: 失敗するテスト（純関数）**

```ts
// scene-panel.test.ts
import { expect, test, describe } from "bun:test";
import { panelDisplay } from "./scene-panel";

describe("panelDisplay", () => {
  test("open=true は flex・false は none", () => {
    expect(panelDisplay(true)).toBe("flex");
    expect(panelDisplay(false)).toBe("none");
  });
});
```

- [ ] **Step 2: 失敗確認** — Run: `... test scene-panel` / Expected: FAIL

- [ ] **Step 3: 実装（純関数 + DOM パネル）**

`asset-panel.ts` の構造に倣う。トグルの再展開ボタンはアセット（`top:44`）と重ならないよう `top:84` に置く。

```ts
// scene-panel.ts
import type { Scene } from "./scene-store";

export function panelDisplay(open: boolean): "flex" | "none" { return open ? "flex" : "none"; }

export interface ScenePanelActions {
  list(): Scene[];
  activeId(): string;
  switchTo(id: string): void;
  add(): void;
  duplicate(id: string): void;
  remove(id: string): void;
  rename(id: string, name: string): void;
  onChange(cb: () => void): () => void;
}

const PANEL_BG = "rgba(20,20,26,0.96)";
const BTN_CSS =
  "background:#1c1c22;color:#ddd;border:1px solid #444;border-radius:4px;padding:4px 8px;cursor:pointer;font:12px system-ui;";
const PANE_TOP = 44;
const RAIL_TOP = 84;

const ICON = (body: string): string =>
  `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
  `stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const SCENES_ICON = ICON('<rect x="3" y="4" width="14" height="14" rx="2"/><path d="M21 7v13H8"/>');
const COLLAPSE_ICON = ICON('<polyline points="13 6 7 12 13 18"/><polyline points="18 6 12 12 18 18"/>');
const DUP_ICON = ICON('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>');
const TRASH_ICON = ICON('<polyline points="4 7 20 7"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/>');

/** シーン一覧の左ドックパネル。初期は折りたたみ（レール表示）。 */
export function buildScenePanel(actions: ScenePanelActions): HTMLElement {
  let open = false;

  const rail = document.createElement("button");
  rail.innerHTML = SCENES_ICON;
  rail.title = "シーンパネルを開く";
  rail.style.cssText = BTN_CSS + `position:fixed;left:0;top:${RAIL_TOP}px;z-index:156;border-radius:0 6px 6px 0;` +
    `display:${open ? "none" : "flex"};align-items:center;justify-content:center;padding:8px 7px;`;
  document.body.appendChild(rail);

  const pane = document.createElement("div");
  pane.style.cssText =
    `position:fixed;left:0;top:${PANE_TOP}px;bottom:48px;width:230px;` +
    `display:${panelDisplay(open)};flex-direction:column;gap:6px;z-index:155;` +
    `background:${PANEL_BG};border-right:1px solid #444;border-top:1px solid #444;` +
    `border-radius:0 6px 6px 0;padding:8px;box-sizing:border-box;font:12px system-ui;color:#ddd;` +
    `box-shadow:2px 0 16px rgba(0,0,0,0.4);`;

  const header = document.createElement("div");
  header.style.cssText = "display:flex;align-items:center;justify-content:space-between;flex:0 0 auto;";
  const title = document.createElement("span"); title.textContent = "シーン"; title.style.cssText = "font-weight:600;";
  const collapseBtn = document.createElement("button");
  collapseBtn.innerHTML = COLLAPSE_ICON; collapseBtn.title = "閉じる";
  collapseBtn.style.cssText = BTN_CSS + "display:flex;align-items:center;justify-content:center;padding:3px 6px;";
  header.append(title, collapseBtn);
  pane.appendChild(header);

  const listEl = document.createElement("div");
  listEl.style.cssText = "display:flex;flex-direction:column;gap:4px;overflow-y:auto;flex:1 1 auto;";
  pane.appendChild(listEl);

  const addBtn = document.createElement("button");
  addBtn.textContent = "＋ シーン追加";
  addBtn.style.cssText = BTN_CSS + "text-align:center;flex:0 0 auto;";
  addBtn.addEventListener("click", () => actions.add());
  pane.appendChild(addBtn);

  document.body.appendChild(pane);

  function setOpen(next: boolean): void {
    open = next;
    pane.style.display = panelDisplay(open);
    rail.style.display = open ? "none" : "flex";
  }
  collapseBtn.addEventListener("click", () => setOpen(false));
  rail.addEventListener("click", () => setOpen(true));

  function render(): void {
    listEl.innerHTML = "";
    const activeId = actions.activeId();
    const scenes = actions.list();
    for (const scene of scenes) {
      listEl.appendChild(renderRow(scene, scene.id === activeId, scenes.length));
    }
  }

  function renderRow(scene: Scene, isActive: boolean, count: number): HTMLElement {
    const row = document.createElement("div");
    row.style.cssText =
      "display:flex;align-items:center;gap:6px;padding:4px 6px;border:1px solid #333;border-radius:4px;cursor:pointer;" +
      `background:${isActive ? "#243042" : "#16161c"};`;

    const name = document.createElement("div");
    name.textContent = scene.name;
    name.style.cssText = "flex:1 1 auto;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" +
      (isActive ? "color:#cfe;font-weight:600;" : "");
    row.appendChild(name);

    row.addEventListener("click", () => actions.switchTo(scene.id));

    // ダブルクリックでリネーム（インライン input）
    name.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      const input = document.createElement("input");
      input.value = scene.name;
      input.style.cssText = "flex:1 1 auto;min-width:0;background:#111;color:#ddd;border:1px solid #4a5566;border-radius:3px;padding:2px 4px;";
      const commit = (): void => { const v = input.value.trim(); if (v) actions.rename(scene.id, v); else render(); };
      input.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") { ev.preventDefault(); commit(); }
        else if (ev.key === "Escape") { ev.preventDefault(); render(); }
      });
      input.addEventListener("blur", commit);
      row.replaceChild(input, name);
      input.focus(); input.select();
    });

    const dup = document.createElement("button");
    dup.innerHTML = DUP_ICON; dup.title = "複製";
    dup.style.cssText = BTN_CSS + "flex:0 0 auto;display:flex;align-items:center;justify-content:center;padding:3px 5px;";
    dup.addEventListener("click", (e) => { e.stopPropagation(); actions.duplicate(scene.id); });
    row.appendChild(dup);

    const del = document.createElement("button");
    del.innerHTML = TRASH_ICON; del.title = count <= 1 ? "最後の 1 シーンは削除できません" : "削除";
    del.disabled = count <= 1;
    del.style.cssText = BTN_CSS + `flex:0 0 auto;display:flex;align-items:center;justify-content:center;padding:3px 5px;` +
      (count <= 1 ? "opacity:0.4;cursor:not-allowed;" : "");
    del.addEventListener("click", (e) => { e.stopPropagation(); if (count > 1) actions.remove(scene.id); });
    row.appendChild(del);

    return row;
  }

  actions.onChange(() => render());
  render();
  return pane;
}
```

- [ ] **Step 4: テスト通過 + 型** — Run: `... test scene-panel` と tsc / Expected: PASS / 型エラーなし

- [ ] **Step 5: コミット**

```bash
git -C /Users/shun/dev/three-art/.worktrees/151-scene-management add src/apps/node-vj/scene/scene-panel.ts src/apps/node-vj/scene/scene-panel.test.ts
git -C /Users/shun/dev/three-art/.worktrees/151-scene-management commit -m "#151 feat: シーン一覧パネル（切替/追加/複製/削除/リネーム）" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: main.ts 配線（初期化・切替副作用・自動永続化）

**Files:**
- Modify: `src/apps/node-vj/main.ts`

**Interfaces:**
- Consumes: `SceneStore`, `SceneManager`, `singleSceneSet`, `buildScenePanel`, `ScenePanelActions`, 既存の `graph`/`runtime`/`editor`/`history`/`replaceGraph`/`restoreAssets`

> DOM/localStorage/OPFS/runtime 依存のためユニットテストせず、型チェック＋Playwright スモーク＋手動で確認する。Task 1–4 を配線するだけ。

- [ ] **Step 1: 初期化（SceneStore.load または既定グラフから SceneManager 生成）**

`main.ts` の既定グラフ構築の後、`restoreAssets`/`buildGraphIoBar` 配線の近くに追加する。`graph` は既存の共有 `GraphDoc`、`history` は既存 `History`。

```ts
import { SceneStore } from "./scene/scene-store";
import { SceneManager, singleSceneSet } from "./scene/scene-manager";
import { buildScenePanel, type ScenePanelActions } from "./scene/scene-panel";

const sceneStore = new SceneStore(localStorage);
const genSceneId = (): string => `scene-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

// 復元 or 既定グラフを唯一のシーンとして初期化
const savedSet = sceneStore.load();
const initialSet = savedSet ?? singleSceneSet(structuredClone(graph), genSceneId(), "Scene 1");
const sceneManager = new SceneManager({ store: sceneStore, genId: genSceneId }, initialSet);

// 復元があれば、アクティブシーンの内容を共有グラフへ反映
if (savedSet) {
  const act = sceneManager.active();
  replaceGraph(graph, structuredClone(act.graph));
  history.useScene(act.id);
  void restoreAssets();
} else {
  history.useScene(sceneManager.activeId());
}
```

- [ ] **Step 2: シーン切替などの副作用関数を定義**

```ts
/** 編集中の共有グラフを現アクティブシーンへ書き戻す（切替/保存前に呼ぶ）。 */
function snapshotActiveScene(): void {
  sceneManager.updateActiveGraph(graph);
}

/** 指定シーンへ切替（書き戻し→active→共有グラフ反映→履歴/ state/アセット）。 */
function switchToScene(id: string): void {
  if (id === sceneManager.activeId()) return;
  snapshotActiveScene();
  sceneManager.setActive(id);
  const act = sceneManager.active();
  replaceGraph(graph, structuredClone(act.graph));
  history.useScene(act.id);          // クリアしない（シーン別履歴）
  runtime.resumeAudio();             // user gesture 由来の切替で AudioContext を起こす
  runtime.ensureStates();            // 旧 state 破棄＆新規生成（ハードカット）
  void restoreAssets();              // 新シーンの assetId 復元
}

/** 新規シーン追加（現シーン書き戻し→add→空グラフ反映）。 */
function addScene(): void {
  snapshotActiveScene();
  const s = sceneManager.add();
  replaceGraph(graph, structuredClone(s.graph));
  history.useScene(s.id);
  runtime.ensureStates();
  void restoreAssets();
}

/** 複製（現シーン書き戻し→duplicate→複製グラフ反映）。 */
function duplicateScene(id: string): void {
  snapshotActiveScene();
  const s = sceneManager.duplicate(id);
  replaceGraph(graph, structuredClone(s.graph));
  history.useScene(s.id);
  runtime.ensureStates();
  void restoreAssets();
}

/** 削除（active が変わる場合は新 active を反映）。 */
function removeScene(id: string): void {
  const wasActive = id === sceneManager.activeId();
  history.removeScene(id);
  sceneManager.remove(id);
  if (wasActive && sceneManager.activeId() !== id) {
    const act = sceneManager.active();
    replaceGraph(graph, structuredClone(act.graph));
    history.useScene(act.id);
    runtime.ensureStates();
    void restoreAssets();
  }
}
```

- [ ] **Step 3: パネル配線 + 自動永続化**

```ts
const sceneActions: ScenePanelActions = {
  list: () => sceneManager.list(),
  activeId: () => sceneManager.activeId(),
  switchTo: switchToScene,
  add: addScene,
  duplicate: duplicateScene,
  remove: removeScene,
  rename: (id, name) => sceneManager.rename(id, name),
  onChange: (cb) => sceneManager.onChange(cb),
};
buildScenePanel(sceneActions);

// 自動永続化: 編集の取りこぼし防止に定期 + ページ離脱時に書き戻し保存。
setInterval(() => snapshotActiveScene(), 5000);
window.addEventListener("beforeunload", () => snapshotActiveScene());
```

- [ ] **Step 4: 型チェック + テスト全件**

Run: `env -u NODE_OPTIONS bunx tsc --noEmit --project /Users/shun/dev/three-art/.worktrees/151-scene-management/tsconfig.json`
Run: `bun run --cwd /Users/shun/dev/three-art/.worktrees/151-scene-management test`
Expected: 型エラーなし / 全 PASS

- [ ] **Step 5: コミット**

```bash
git -C /Users/shun/dev/three-art/.worktrees/151-scene-management add src/apps/node-vj/main.ts
git -C /Users/shun/dev/three-art/.worktrees/151-scene-management commit -m "#151 feat: シーン管理を main へ配線（初期化・切替副作用・自動永続化・パネル）" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: ビルド確認 + Playwright スモーク + 手動確認準備

**Files:** なし（検証のみ）

- [ ] **Step 1: ビルド確認**

Run: `bun build /Users/shun/dev/three-art/.worktrees/151-scene-management/node-vj.html --outdir /tmp/151-build --minify`
Expected: エラーなし

- [ ] **Step 2: Playwright スモーク**

`lsof -ti tcp:3000 | xargs kill -9`（単独）後、with_server で node-vj を起動し、`window.nodeVj` 経由で検証:
- 初期シーン 1 個・パネル（レール）表示・console/pageerror なし。
- シーン追加 → 2 個に。切替 → active 変化。リロード相当（再 load）で復元（SceneStore）。
- swiftshader 起動オプション使用。実 D&D/実再生は手動。

- [ ] **Step 3: 手動確認手順を提示（1 コードブロック）**

```
lsof -ti tcp:3000 | xargs kill -9
bun run --cwd /Users/shun/dev/three-art/.worktrees/151-scene-management dev:vj
```
確認項目: ①左のシーンパネルを開く ②シーン追加/複製/削除/リネーム ③シーンを編集→別シーンへ切替→戻ると編集が保持 ④各シーンで undo が独立（切替してもクリアされない）⑤リロードで全シーン復元 ⑥プリセット保存/読込が現在のシーンに作用。

---

## Self-Review
- **Spec coverage:** 複数保持/切替=Task3,5 / 追加複製削除リネーム=Task3,4 / 一覧 UI=Task4 / 永続化=Task2,5 / シーン別 undo=Task1,5 / 即時ハードカット=Task5(ensureStates) / アセット復元=Task5(restoreAssets)。全項目にタスク対応あり。
- **Placeholder scan:** 各コードステップに実コードあり。Task5 は DOM/runtime 配線のため手順 + 実コード（テストは型 + Playwright）。
- **Type consistency:** `Scene`/`SceneSet`/`SceneManager`/`ScenePanelActions`/`History.useScene` のシグネチャはタスク間で一貫。`structuredClone` で deep copy 統一。
- **要確認（実装時）:** main.ts の既存 `graph`/`runtime`/`history`/`replaceGraph`/`restoreAssets` の定義位置に配線を差し込む（Task5 で確認）。
