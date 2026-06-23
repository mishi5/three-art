# シーンをノード化（#152 Phase 1: テクスチャ＋循環防止）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans / subagent-driven-development。Steps は checkbox（`- [ ]`）。

**Goal:** `SceneInput` ノードで別シーンの最終映像（Screen 出力テクスチャ）を参照・合成できるようにし、シーン間の循環参照を検出・禁止する（Phase 1・映像のみ）。

**Architecture:** ランタイムがアクティブグラフ評価の前に、参照先シーンを依存順（DAG）に評価して専用 RT へ合成し `sceneId→texture` をキャッシュ。`SceneInput.evaluate` は env 経由でキャッシュを読むだけ。循環は全シーンの参照有向グラフの DFS で防止。

**Tech Stack:** Bun + TypeScript + Three.js。テスト `bun run --cwd <wt> test`、型 `env -u NODE_OPTIONS bunx tsc --noEmit --project <wt>/tsconfig.json`。

- Issue: https://github.com/mishi5/three-art/issues/152
- Design: docs/plans/2026-06-23-152-scene-as-node-design.md

## Global Constraints
- コミット先頭 `#152 <種別>: <説明>`、末尾 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。
- 新規は `nodes/`・`scene/` 配下。ブラウザ/WebGL/DOM 依存は純関数＋スタブのみ単体テスト。
- Phase 1 は映像のみ（音声は Phase 2）。日本語コメント・2 space・ASCII。

## File Structure
- Create `src/apps/node-vj/scene/scene-refs.ts`(+test) — 純関数（参照収集・循環検出・評価順）
- Create `src/apps/node-vj/nodes/SceneInputNode.ts` — SceneInput ノード定義
- Modify `src/apps/node-vj/graph/node-type.ts` — `NodeEnv.sceneTexture?`、`NodeTypeDef.sceneInput?`
- Modify `src/apps/node-vj/nodes/registry.ts` — SceneInput 登録
- Modify `src/apps/node-vj/editor/layout.ts`(+test) — scene 行レイアウト
- Modify `src/apps/node-vj/editor/NodeEditor.ts` — scene 行描画＋選択ドロップダウン＋コールバック
- Modify `src/apps/node-vj/graph/runtime.ts` — シーン事前評価・sceneProvider・sceneTexture キャッシュ
- Modify `src/apps/node-vj/main.ts` — 配線（sceneProvider・sceneSelect）

---

### Task 1: node-type 拡張（sceneTexture / sceneInput）

**Files:** Modify `src/apps/node-vj/graph/node-type.ts`

**Interfaces:**
- Produces: `NodeEnv.sceneTexture?(sceneId: string): unknown`、`NodeTypeDef.sceneInput?: boolean`

- [ ] **Step 1: NodeEnv に sceneTexture を追加**（`audioContext` の下）:
```ts
  /** #152: 参照先シーンの合成テクスチャを引く（SceneInput 用。ランタイムが毎フレーム用意）。 */
  sceneTexture?(sceneId: string): unknown;
```
- [ ] **Step 2: NodeTypeDef に sceneInput を追加**（`fileInput?` の近く）:
```ts
  /** #152: ノードに「シーン選択行」を出す目印（SceneInput）。params.sceneId に参照先シーン id を持つ。 */
  sceneInput?: boolean;
```
- [ ] **Step 3: 型チェック** — Run: tsc / Expected: エラーなし（任意プロパティ追加のみ）
- [ ] **Step 4: コミット**
```bash
git -C /Users/shun/dev/three-art/.worktrees/152-scene-as-node add src/apps/node-vj/graph/node-type.ts
git -C /Users/shun/dev/three-art/.worktrees/152-scene-as-node commit -m "#152 feat: NodeEnv.sceneTexture / NodeTypeDef.sceneInput を追加" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: scene-refs（参照収集・循環検出・評価順・純関数）

**Files:** Create `src/apps/node-vj/scene/scene-refs.ts` / Test `src/apps/node-vj/scene/scene-refs.test.ts`

**Interfaces:**
- Consumes: `GraphDoc`、`NodeRegistry`
- Produces:
  - `collectSceneRefs(graph: GraphDoc, registry: NodeRegistry): string[]`
  - `wouldCreateSceneCycle(scenes: ReadonlyArray<{ id: string; graph: GraphDoc }>, registry: NodeRegistry, fromSceneId: string, toSceneId: string): boolean`
  - `sceneRenderOrder(activeSceneId: string, scenes: ReadonlyArray<{ id: string; graph: GraphDoc }>, registry: NodeRegistry): string[]`

- [ ] **Step 1: 失敗するテスト**
```ts
// scene-refs.test.ts
import { expect, test, describe } from "bun:test";
import { collectSceneRefs, wouldCreateSceneCycle, sceneRenderOrder } from "./scene-refs";
import { createDefaultRegistry } from "../nodes/registry";
import { createGraph, addNode, type GraphDoc } from "../graph/graph-doc";

const reg = createDefaultRegistry();
function sceneGraph(refs: string[]): GraphDoc {
  const g = createGraph();
  refs.forEach((sid, i) => addNode(g, { id: `si${i}`, type: "SceneInput", params: { sceneId: sid } }));
  return g;
}

describe("collectSceneRefs", () => {
  test("SceneInput の非空 sceneId を集める", () => {
    const g = sceneGraph(["B", "", "C"]);
    expect(collectSceneRefs(g, reg).sort()).toEqual(["B", "C"]);
  });
});

describe("wouldCreateSceneCycle", () => {
  test("自己参照は true", () => {
    const scenes = [{ id: "A", graph: createGraph() }];
    expect(wouldCreateSceneCycle(scenes, reg, "A", "A")).toBe(true);
  });
  test("直接循環 A→B 既存で B→A 追加は true", () => {
    const scenes = [
      { id: "A", graph: sceneGraph(["B"]) },
      { id: "B", graph: createGraph() },
    ];
    expect(wouldCreateSceneCycle(scenes, reg, "B", "A")).toBe(true);
  });
  test("間接循環 A→B→C 既存で C→A 追加は true", () => {
    const scenes = [
      { id: "A", graph: sceneGraph(["B"]) },
      { id: "B", graph: sceneGraph(["C"]) },
      { id: "C", graph: createGraph() },
    ];
    expect(wouldCreateSceneCycle(scenes, reg, "C", "A")).toBe(true);
  });
  test("循環しない追加は false", () => {
    const scenes = [
      { id: "A", graph: sceneGraph(["B"]) },
      { id: "B", graph: createGraph() },
      { id: "C", graph: createGraph() },
    ];
    expect(wouldCreateSceneCycle(scenes, reg, "A", "C")).toBe(false);
  });
});

describe("sceneRenderOrder", () => {
  test("到達する参照先を依存順（leaf 先）で返す（active 自身は除外）", () => {
    const scenes = [
      { id: "A", graph: sceneGraph(["B"]) },
      { id: "B", graph: sceneGraph(["C"]) },
      { id: "C", graph: createGraph() },
      { id: "D", graph: createGraph() }, // 到達しない
    ];
    const order = sceneRenderOrder("A", scenes, reg);
    expect(order).toEqual(["C", "B"]);
  });
  test("循環があっても無限ループしない（保険）", () => {
    const scenes = [
      { id: "A", graph: sceneGraph(["B"]) },
      { id: "B", graph: sceneGraph(["A"]) },
    ];
    const order = sceneRenderOrder("A", scenes, reg);
    expect(order).toContain("B"); // 落ちずに有限で返る
  });
});
```

- [ ] **Step 2: 失敗確認** — Run: `... test scene-refs` / Expected: FAIL

- [ ] **Step 3: 実装**
```ts
// scene-refs.ts
import type { GraphDoc } from "../graph/graph-doc";
import type { NodeRegistry } from "../graph/node-type";

/** グラフ内 SceneInput ノードの参照シーン id（非空）を集める。 */
export function collectSceneRefs(graph: GraphDoc, registry: NodeRegistry): string[] {
  const out: string[] = [];
  for (const n of graph.nodes) {
    const def = registry.get(n.type);
    if (!def?.sceneInput) continue;
    const sid = (n.params as Record<string, unknown>).sceneId;
    if (typeof sid === "string" && sid !== "") out.push(sid);
  }
  return out;
}

type SceneList = ReadonlyArray<{ id: string; graph: GraphDoc }>;

function refMap(scenes: SceneList, registry: NodeRegistry): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const s of scenes) m.set(s.id, collectSceneRefs(s.graph, registry));
  return m;
}

/** from→to の参照を加えるとシーン参照グラフが循環するか（自己参照も true）。 */
export function wouldCreateSceneCycle(
  scenes: SceneList, registry: NodeRegistry, fromSceneId: string, toSceneId: string,
): boolean {
  if (fromSceneId === toSceneId) return true;
  const m = refMap(scenes, registry);
  // to から from へ到達できれば、from→to 追加で循環。
  const stack = [toSceneId];
  const seen = new Set<string>();
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === fromSceneId) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const next of m.get(cur) ?? []) stack.push(next);
  }
  return false;
}

/** activeSceneId から到達する参照先シーンを依存順（leaf 先）で返す（active 自身は含めない）。 */
export function sceneRenderOrder(
  activeSceneId: string, scenes: SceneList, registry: NodeRegistry,
): string[] {
  const m = refMap(scenes, registry);
  const order: string[] = [];
  const done = new Set<string>();
  const onStack = new Set<string>();
  function visit(id: string): void {
    if (done.has(id) || onStack.has(id)) return; // 循環保険: onStack は無視
    onStack.add(id);
    for (const ref of m.get(id) ?? []) visit(ref);
    onStack.delete(id);
    done.add(id);
    if (id !== activeSceneId) order.push(id);
  }
  visit(activeSceneId);
  return order;
}
```

- [ ] **Step 4: テスト通過 + 型** — Run: `... test scene-refs` と tsc / Expected: PASS / 型エラーなし
- [ ] **Step 5: コミット**
```bash
git -C /Users/shun/dev/three-art/.worktrees/152-scene-as-node add src/apps/node-vj/scene/scene-refs.ts src/apps/node-vj/scene/scene-refs.test.ts
git -C /Users/shun/dev/three-art/.worktrees/152-scene-as-node commit -m "#152 feat: scene-refs（参照収集・循環検出・評価順）" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: SceneInputNode + registry 登録

**Files:** Create `src/apps/node-vj/nodes/SceneInputNode.ts` / Test `src/apps/node-vj/nodes/scene-input-node.test.ts` / Modify `registry.ts`

**Interfaces:**
- Consumes: `NodeEnv.sceneTexture`、`NodeTypeDef.sceneInput`
- Produces: `SceneInputNode: NodeTypeDef`（type "SceneInput"・texture 出力・sceneId param hidden）

- [ ] **Step 1: 失敗するテスト**
```ts
// scene-input-node.test.ts
import { expect, test, describe } from "bun:test";
import { SceneInputNode } from "./SceneInputNode";
import type { EvalContext } from "../graph/node-type";

function ctx(sceneId: string, tex: unknown): EvalContext {
  return {
    timeSec: 0,
    input: () => undefined,
    param: (id) => (id === "sceneId" ? sceneId : undefined),
    node: { id: "n", type: "SceneInput", params: { sceneId } },
    env: { audio: {} as never, renderer: {} as never, camera: {} as never, audioContext: {} as never,
      sceneTexture: (id) => (id === sceneId ? tex : null) },
  };
}

describe("SceneInputNode", () => {
  test("texture 出力・sceneInput フラグ・sceneId は hidden", () => {
    expect(SceneInputNode.type).toBe("SceneInput");
    expect(SceneInputNode.sceneInput).toBe(true);
    expect(SceneInputNode.outputs.map((p) => p.id)).toEqual(["texture"]);
    expect(SceneInputNode.params.find((p) => p.id === "sceneId")?.hidden).toBe(true);
  });
  test("evaluate は env.sceneTexture(sceneId) を texture に返す", () => {
    const fake = {};
    expect(SceneInputNode.evaluate(ctx("B", fake)).texture).toBe(fake);
    expect(SceneInputNode.evaluate(ctx("", fake)).texture).toBeUndefined();
  });
});
```

- [ ] **Step 2: 失敗確認** — Run: `... test scene-input-node` / Expected: FAIL

- [ ] **Step 3: 実装**
```ts
// SceneInputNode.ts
import type { NodeTypeDef } from "../graph/node-type";

/** #152: 別シーンの最終映像（Screen 出力 texture）を参照・出力する入力ノード。 */
export const SceneInputNode: NodeTypeDef = {
  type: "SceneInput",
  category: "input",
  description: "別のシーンの最終映像を texture として取り込むノード。シーン選択行で参照先を選ぶ（循環は禁止）。",
  isSink: false,
  sceneInput: true,
  inputs: [],
  outputs: [{ id: "texture", label: "tex", type: "texture", description: "参照先シーンの最終映像テクスチャ。" }],
  params: [
    { id: "sceneId", label: "scene", kind: "string", default: "", hidden: true,
      description: "参照先シーンの id（シーン選択行で設定・UI 非表示）。" },
  ],
  evaluate: (ctx) => {
    const sid = ctx.param("sceneId");
    if (typeof sid !== "string" || sid === "") return {};
    return { texture: ctx.env?.sceneTexture?.(sid) ?? undefined };
  },
};
```

- [ ] **Step 4: registry 登録** — `registry.ts` の input 群に追加:
```ts
import { SceneInputNode } from "./SceneInputNode";
// ...
  r.register(SceneInputNode);
```

- [ ] **Step 5: テスト通過 + 型** — Run: `... test scene-input-node` と tsc / Expected: PASS / 型エラーなし
- [ ] **Step 6: コミット**
```bash
git -C /Users/shun/dev/three-art/.worktrees/152-scene-as-node add src/apps/node-vj/nodes/SceneInputNode.ts src/apps/node-vj/nodes/scene-input-node.test.ts src/apps/node-vj/nodes/registry.ts
git -C /Users/shun/dev/three-art/.worktrees/152-scene-as-node commit -m "#152 feat: SceneInput ノード（別シーンの映像を texture 出力）" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: layout に scene 行を追加

**Files:** Modify `src/apps/node-vj/editor/layout.ts` / Test `src/apps/node-vj/editor/layout.test.ts`（既存に追記）

**Interfaces:**
- Produces: `hasSceneRow(def): boolean`、`sceneRowRect(node, def): {x,y,w,h} | null`、`sceneRowLabel(name): string`。`nodeHeight` は sceneInput ノードで 1 行ぶん高くなる。

- [ ] **Step 1: 失敗するテスト（layout.test.ts に追記）**
```ts
test("#152 sceneInput ノードは scene 行を持ち高さが 1 行ぶん増える", () => {
  const def = { type: "X", inputs: [], outputs: [{ id: "texture", label: "t", type: "texture" as const }], params: [], sceneInput: true } as unknown as import("../graph/node-type").NodeTypeDef;
  expect(hasSceneRow(def)).toBe(true);
  const node = { id: "n", type: "X", params: {}, position: { x: 10, y: 20 } };
  const r = sceneRowRect(node, def)!;
  expect(r.x).toBe(10);
  expect(r.w).toBe(NODE_WIDTH);
  expect(r.h).toBe(ROW_H);
});
test("#152 sceneRowLabel 未選択表示", () => {
  expect(sceneRowLabel(null)).toBe("(シーン未選択)");
  expect(sceneRowLabel("Intro")).toBe("Intro");
});
```
（`hasSceneRow`/`sceneRowRect`/`sceneRowLabel`/`NODE_WIDTH`/`ROW_H` を layout.test.ts の import に追加する。）

- [ ] **Step 2: 失敗確認** — Run: `... test layout` / Expected: FAIL

- [ ] **Step 3: 実装（layout.ts）**
`nodeHeight` に scene 行ぶんを加える。scene 行は params 行の直後（file 行/random 行と排他的に SceneInput のみ持つ）。
```ts
/** #152: SceneInput のシーン選択行を出すか。 */
export function hasSceneRow(def: NodeTypeDef): boolean {
  return !!def.sceneInput;
}
```
`nodeHeight` の合算に `const sceneRow = hasSceneRow(def) ? ROW_H : 0;` を足す（`fileRows`/`randomRow` と同様、`return TITLE_H + portRows*ROW_H + visibleParamCount*ROW_H + randomRow + fileRows + sceneRow + PADDING;`）。
```ts
/** #152: シーン選択行の矩形（params 直後・sceneInput 無しは null）。 */
export function sceneRowRect(node: NodeInstance, def: NodeTypeDef): { x: number; y: number; w: number; h: number } | null {
  if (!hasSceneRow(def)) return null;
  const p = nodePos(node);
  return { x: p.x, y: p.y + TITLE_H + portRows(def) * ROW_H + visibleParamCount(def) * ROW_H, w: NODE_WIDTH, h: ROW_H };
}
/** #152: シーン選択行のラベル。未選択は「(シーン未選択)」。 */
export function sceneRowLabel(name: string | null | undefined): string {
  return name ? name : "(シーン未選択)";
}
```

- [ ] **Step 4: テスト通過 + 型** — Run: `... test layout` と tsc / Expected: PASS / 型エラーなし
- [ ] **Step 5: コミット**
```bash
git -C /Users/shun/dev/three-art/.worktrees/152-scene-as-node add src/apps/node-vj/editor/layout.ts src/apps/node-vj/editor/layout.test.ts
git -C /Users/shun/dev/three-art/.worktrees/152-scene-as-node commit -m "#152 feat: layout に SceneInput のシーン選択行" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: ランタイムのシーン事前評価（sceneTexture キャッシュ）

**Files:** Modify `src/apps/node-vj/graph/runtime.ts`

> WebGL/状態管理依存のため単体テストせず、tsc＋Playwright スモーク＋手動で確認。

- [ ] **Step 1: sceneProvider と per-scene 評価器を追加**

`runtime.ts` に以下を追加（`import { sceneRenderOrder } from "../scene/scene-refs";`、`import * as THREE` は既存）:
```ts
  private sceneProvider: ((id: string) => GraphDoc | null) | null = null;
  /** sceneId → そのシーン専用の評価リソース（state/def/RT）。 */
  private sceneRes = new Map<string, { states: Map<string, NodeState>; defs: Map<string, NodeTypeDef>; rt: THREE.WebGLRenderTarget }>();
  private sceneTextureCache = new Map<string, THREE.Texture>();
  private activeSceneId = "";

  /** #152: シーン id → GraphDoc を引く provider と現在のアクティブシーン id を設定する。 */
  setSceneProvider(provider: (id: string) => GraphDoc | null, activeSceneId: string): void {
    this.sceneProvider = provider;
    this.activeSceneId = activeSceneId;
  }
```

- [ ] **Step 2: env に sceneTexture を追加**
```ts
  private env(): NodeEnv {
    return {
      audio: this.audio,
      renderer: this.renderer,
      camera: this.camera,
      audioContext: this.getAudioContext(),
      sceneTexture: (id) => this.sceneTextureCache.get(id) ?? null,
    };
  }
```

- [ ] **Step 3: tick 冒頭で参照先シーンを事前評価**

`tick` の `this.syncStates();` の後、アクティブ `evaluate` の前に挿入:
```ts
    this.renderReferencedScenes(timeSec);
```
メソッド実装:
```ts
  /** #152: アクティブグラフから参照される全シーンを依存順に評価し、各シーンを専用 RT へ合成して sceneTextureCache に積む。 */
  private renderReferencedScenes(timeSec: number): void {
    const provider = this.sceneProvider;
    if (!provider) return;
    // sceneRenderOrder は scenes リスト（id, graph）を要求。provider から集める必要があるが、
    // ここではアクティブ graph と provider をたどって到達シーンを解決する。
    const order = this.collectSceneOrder();
    const alive = new Set(order);
    // 不要シーンのリソース破棄
    for (const [id, res] of [...this.sceneRes.entries()]) {
      if (!alive.has(id)) {
        const env = this.env();
        for (const [nid, st] of res.states) res.defs.get(nid)?.disposeState?.(st, env);
        res.rt.dispose();
        this.sceneRes.delete(id);
        this.sceneTextureCache.delete(id);
      }
    }
    for (const id of order) {
      const graph = provider(id);
      if (!graph) continue;
      const res = this.ensureSceneRes(id);
      this.syncStatesFor(graph, res);
      const outputs = evaluate(graph, this.registry, {
        timeSec, env: this.env(), state: (nid) => res.states.get(nid),
      });
      const textures = pickScreenTextures(graph, this.registry, outputs);
      const w = this.renderer.domElement.width, h = this.renderer.domElement.height;
      if (res.rt.width !== w || res.rt.height !== h) res.rt.setSize(w, h);
      const prev = this.renderer.getRenderTarget();
      this.renderer.setRenderTarget(res.rt);
      this.renderer.clear();
      textures.forEach((tex, i) => this.blitter.blit(this.renderer, tex as THREE.Texture, i > 0));
      this.renderer.setRenderTarget(prev);
      this.sceneTextureCache.set(id, res.rt.texture);
    }
  }

  /** アクティブグラフ＋provider から到達する参照先シーンを依存順で返す。 */
  private collectSceneOrder(): string[] {
    const provider = this.sceneProvider!;
    // provider が解決できる範囲でシーンリストを構築（到達分のみ）。
    const scenes: { id: string; graph: GraphDoc }[] = [];
    const seen = new Set<string>();
    const stack = [this.activeSceneId];
    // active の graph は this.graph（編集中の最新）を使う
    const graphOf = (id: string): GraphDoc | null => (id === this.activeSceneId ? this.graph : provider(id));
    while (stack.length) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const g = graphOf(id);
      if (!g) continue;
      if (id !== this.activeSceneId) scenes.push({ id, graph: g });
      for (const ref of collectSceneRefs(g, this.registry)) stack.push(ref);
    }
    // active を含めた依存順を作るため active も一時加える
    const all = [{ id: this.activeSceneId, graph: this.graph }, ...scenes];
    return sceneRenderOrder(this.activeSceneId, all, this.registry);
  }

  private ensureSceneRes(id: string) {
    let res = this.sceneRes.get(id);
    if (!res) {
      res = { states: new Map(), defs: new Map(), rt: new THREE.WebGLRenderTarget(2, 2, { depthBuffer: true }) };
      this.sceneRes.set(id, res);
    }
    return res;
  }

  /** 指定 graph 専用 state マップを同期（syncStates のシーン版）。 */
  private syncStatesFor(graph: GraphDoc, res: { states: Map<string, NodeState>; defs: Map<string, NodeTypeDef> }): void {
    const env = this.env();
    const aliveIds = new Set(graph.nodes.map((n) => n.id));
    for (const [id, st] of [...res.states.entries()]) {
      if (!aliveIds.has(id)) { res.defs.get(id)?.disposeState?.(st, env); res.states.delete(id); res.defs.delete(id); }
    }
    for (const node of graph.nodes) {
      const def = this.registry.get(node.type);
      if (def?.createState && !res.states.has(node.id)) { res.states.set(node.id, def.createState(env)); res.defs.set(node.id, def); }
    }
  }
```
（`import { collectSceneRefs, sceneRenderOrder } from "../scene/scene-refs";` を追加。`GraphDoc` import は既存。）

- [ ] **Step 4: 型チェック + テスト全件** — Run: tsc と `... test` / Expected: 型エラーなし / 全 PASS（既存維持）
- [ ] **Step 5: コミット**
```bash
git -C /Users/shun/dev/three-art/.worktrees/152-scene-as-node add src/apps/node-vj/graph/runtime.ts
git -C /Users/shun/dev/three-art/.worktrees/152-scene-as-node commit -m "#152 feat: ランタイムで参照先シーンを事前評価し sceneTexture を供給" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: editor のシーン選択行 + main 配線

**Files:** Modify `src/apps/node-vj/editor/NodeEditor.ts`、`src/apps/node-vj/main.ts`

> DOM/WebGL 依存。tsc＋Playwright スモーク＋手動で確認。

- [ ] **Step 1: NodeEditor に sceneSelect コールバックを追加**

コンストラクタ末尾に任意引数:
```ts
    private sceneSelect?: {
      options(nodeId: string): { id: string; name: string }[];
      current(nodeId: string): string | null;
      choose(nodeId: string, sceneId: string): void;
    },
```

- [ ] **Step 2: scene 行の描画**

ノード描画（file 行描画の近く）に sceneInput 用を追加:
```ts
    if (hasSceneRow(def)) {
      const sr = sceneRowRect(node, def)!;
      ctx.fillStyle = "#262630";
      roundRect(ctx, sr.x + 6, sr.y + 2, sr.w - 12, sr.h - 4, 4);
      ctx.fill();
      ctx.strokeStyle = "#4a5566"; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = "#9ab"; ctx.textAlign = "left"; ctx.font = "11px system-ui";
      ctx.fillText("🎬", sr.x + 12, sr.y + sr.h / 2); // 既存 file 行と同様の絵文字は使わず、必要なら "scene:" 等に
      const label = sceneRowLabel(this.sceneSelect?.current(node.id));
      ctx.fillStyle = "#cfe";
      ctx.fillText(ellipsizeEnd(ctx, label, sr.w - 38), sr.x + 30, sr.y + sr.h / 2);
    }
```
（import に `hasSceneRow, sceneRowRect, sceneRowLabel` を追加。アイコンは絵文字を避け `"S"` などテキストでも可。）

- [ ] **Step 3: scene 行クリックでドロップダウン**

`onDown` の hit==="node" 分岐内、file 行判定の近くに:
```ts
      if (def?.sceneInput) {
        const sr = sceneRowRect(hit.node, def);
        if (sr && w.x >= sr.x && w.x <= sr.x + sr.w && w.y >= sr.y && w.y <= sr.y + sr.h) {
          this.openSceneMenu(hit.node.id, sr);
          return;
        }
      }
```
`openSceneMenu` 実装（既存 `buildMenu`/`addMenuItem` を再利用。スクリーン座標へ変換して開く）:
```ts
  private openSceneMenu(nodeId: string, rowWorld: { x: number; y: number; w: number; h: number }): void {
    const opts = this.sceneSelect?.options(nodeId) ?? [];
    const s = worldToScreen(rowWorld.x, rowWorld.y + rowWorld.h, this.offset, this.scale);
    const menu = this.buildMenu(s.x, s.y);
    if (opts.length === 0) { this.addMenuLabel(menu, "(他に選べるシーンなし)"); return; }
    for (const o of opts) this.addMenuItem(menu, o.name, () => this.sceneSelect?.choose(nodeId, o.id));
  }
```

- [ ] **Step 4: main 配線**

`main.ts` の editor 生成に `sceneSelect` を渡す（sceneManager・wouldCreateSceneCycle 使用）:
```ts
import { wouldCreateSceneCycle } from "./scene/scene-refs";
// editor 生成の最後の引数として:
  {
    options: (nodeId) => {
      const activeId = sceneManager.activeId();
      const scenes = sceneManager.list();
      return scenes
        .filter((s) => s.id !== activeId)
        .filter((s) => !wouldCreateSceneCycle(scenes, registry, activeId, s.id))
        .map((s) => ({ id: s.id, name: s.name }));
    },
    current: (nodeId) => {
      const n = graph.nodes.find((x) => x.id === nodeId);
      const sid = (n?.params as Record<string, unknown> | undefined)?.sceneId;
      if (typeof sid !== "string" || !sid) return null;
      return sceneManager.list().find((s) => s.id === sid)?.name ?? "(不明なシーン)";
    },
    choose: (nodeId, sceneId) => {
      const n = graph.nodes.find((x) => x.id === nodeId);
      if (n) n.params.sceneId = sceneId;
    },
  },
```
さらに `runtime.setSceneProvider((id) => sceneManager.list().find((s) => s.id === id)?.graph ?? null, sceneManager.activeId());` を初期化後に呼ぶ。シーン切替時（reflectActiveScene）にも `runtime.setSceneProvider(..., sceneManager.activeId())` で activeSceneId を更新。

- [ ] **Step 5: 型チェック + テスト全件** — Run: tsc と `... test` / Expected: 型エラーなし / 全 PASS
- [ ] **Step 6: コミット**
```bash
git -C /Users/shun/dev/three-art/.worktrees/152-scene-as-node add src/apps/node-vj/editor/NodeEditor.ts src/apps/node-vj/main.ts
git -C /Users/shun/dev/three-art/.worktrees/152-scene-as-node commit -m "#152 feat: シーン選択行 UI と main 配線（sceneProvider/循環除外ドロップダウン）" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: ビルド + Playwright スモーク + 手動確認準備

- [ ] **Step 1: ビルド** — Run: `bun build .../node-vj.html --outdir /tmp/152-build --minify` / Expected: エラーなし
- [ ] **Step 2: Playwright スモーク** — SceneInput ノードを追加→シーン選択行で別シーンを選ぶ（循環候補が除外される）→console/pageerror なし。複数シーン作成し A が B を参照して texture が出ること（描画は手動）。
- [ ] **Step 3: 手動確認手順を提示**
```
lsof -ti tcp:3000 | xargs kill -9
bun run --cwd /Users/shun/dev/three-art/.worktrees/152-scene-as-node dev:vj
```
確認: ①シーン B を作り適当なビジュアル＋Screen を組む ②シーン A で SceneInput を追加し B を選択 → A の Screen へ繋ぐと B の映像が出る ③A→B のとき B のシーン選択候補に A が出ない（循環除外）④B を削除すると SceneInput は黒/未選択になる。

---

## Self-Review
- **Spec coverage:** SceneInput=Task3 / 循環防止=Task2,6 / ランタイム事前評価=Task5 / UI=Task4,6 / 型拡張=Task1。Phase 2（音声）は対象外。
- **Placeholder scan:** 各コードステップに実コードあり。Task5/6 は WebGL/DOM のため手順＋実コード（テストは tsc＋Playwright）。
- **Type consistency:** `sceneTexture`/`sceneInput`/`collectSceneRefs`/`wouldCreateSceneCycle`/`sceneRenderOrder`/`hasSceneRow`/`sceneRowRect`/`sceneRowLabel`/`setSceneProvider` をタスク間で一貫使用。
- **要確認（実装時）:** layout.ts の `visibleParamCount`/`portRows` 名、NodeEditor の `worldToScreen`/`buildMenu`/`addMenuItem`/`ellipsizeEnd`/`roundRect` の存在、main の editor 生成箇所の引数順。実装時に実ファイルで確認。
