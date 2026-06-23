# シーンノードの音声対応（#172 / #152 Phase 2）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans。Steps は checkbox。

**Goal:** 参照先シーンの音声を解析して映像エフェクトを動かし（A）、`SceneInput` の `audio` ポートで親グラフへ Mix・発音できるようにする（B）。

**Architecture:** ランタイムが参照先シーンを「参照先用 env」（referencedScene + captureSceneAudio）で評価。AudioOutput は referencedScene 時に destination へ繋がず gain を captureSceneAudio で通知。各参照先シーンの merge gain を `sceneAudio` で公開し SceneInput が `audio` 出力。参照先の音声入力は assetId 経由で loadFile して解析を走らせる。

**Tech Stack:** Bun + TypeScript + Three.js + WebAudio。テスト `bun run --cwd <wt> test`、型 `env -u NODE_OPTIONS bunx tsc --noEmit --project <wt>/tsconfig.json`。

- Issue: https://github.com/mishi5/three-art/issues/172
- Design: docs/plans/2026-06-23-172-scene-node-audio-design.md

## Global Constraints
- コミット先頭 `#172 <種別>: <説明>`、末尾 Co-Authored-By。WebAudio/DOM 依存は fake env でユニット、実音声は手動/Playwright。

## File Structure
- Modify `graph/node-type.ts` — NodeEnv に referencedScene/captureSceneAudio/sceneAudio
- Modify `nodes/AudioOutputNode.ts`(+test) — referencedScene 文脈対応
- Modify `nodes/SceneInputNode.ts`(+test) — audio 出力
- Modify `graph/runtime.ts` — sceneEnv・audioMerge・sceneAudioCache・restorer
- Modify `main.ts` — setSceneAssetRestorer 配線

---

### Task 1: NodeEnv 拡張

**Files:** Modify `graph/node-type.ts`

- [ ] **Step 1: NodeEnv に追加**（sceneTexture の下）:
```ts
  /** #172: 参照先シーンとして評価中か（AudioOutput が destination 非接続にする等）。 */
  referencedScene?: boolean;
  /** #172: 参照先シーンの音声出力ノードをランタイムへ通知する。 */
  captureSceneAudio?(node: AudioNode): void;
  /** #172: 参照先シーンの音声出力（マージ gain）を引く（SceneInput 用）。 */
  sceneAudio?(sceneId: string): AudioNode | null;
```
- [ ] **Step 2: tsc** / Expected: エラーなし
- [ ] **Step 3: コミット** `#172 feat: NodeEnv に音声シーン参照（referencedScene/captureSceneAudio/sceneAudio）`

---

### Task 2: AudioOutputNode の referencedScene 文脈対応

**Files:** Modify `nodes/AudioOutputNode.ts` / Test `nodes/audio-output-scene.test.ts`（新規）

**Interfaces:** AudioOutput.createState は `env.referencedScene` 時 destination 非接続。evaluate は `env.captureSceneAudio?.(gain)` を呼ぶ。

- [ ] **Step 1: 失敗するテスト**
```ts
// audio-output-scene.test.ts
import { expect, test, describe } from "bun:test";
import { AudioOutputNode } from "./AudioOutputNode";

// 最小の AudioContext/AudioNode スタブ
function fakeCtx() {
  const destination = { _id: "dest" } as unknown as AudioNode;
  const connfalls: AudioNode[] = [];
  const gain = {
    gain: { value: 1 },
    connect: (n: AudioNode) => { connfalls.push(n); },
    disconnect: () => {},
  } as unknown as GainNode;
  const ctx = { destination, createGain: () => gain } as unknown as AudioContext;
  return { ctx, gain, destination, connfalls };
}

describe("AudioOutputNode referencedScene", () => {
  test("通常（active）は gain を destination へ接続", () => {
    const f = fakeCtx();
    AudioOutputNode.createState!({ audioContext: f.ctx } as never);
    expect(f.connfalls).toContain(f.destination);
  });
  test("referencedScene では destination へ接続しない", () => {
    const f = fakeCtx();
    AudioOutputNode.createState!({ audioContext: f.ctx, referencedScene: true } as never);
    expect(f.connfalls).not.toContain(f.destination);
  });
  test("evaluate は captureSceneAudio(gain) を呼ぶ", () => {
    const f = fakeCtx();
    const st = AudioOutputNode.createState!({ audioContext: f.ctx, referencedScene: true } as never);
    let captured: AudioNode | null = null;
    AudioOutputNode.evaluate({
      timeSec: 0, input: () => undefined, param: (id) => (id === "mute" ? "off" : 1),
      node: { id: "n", type: "AudioOutput", params: {} }, state: st,
      env: { captureSceneAudio: (n) => { captured = n; } } as never,
    });
    expect(captured).toBe(f.gain);
  });
});
```
- [ ] **Step 2: 失敗確認** — `... test audio-output-scene` / FAIL
- [ ] **Step 3: 実装** — `createState`:
```ts
  createState(env: NodeEnv): AudioOutputState {
    const ctx = env.audioContext;
    const gain = ctx.createGain();
    if (!env.referencedScene) gain.connect(ctx.destination); // #172: 参照先では destination 非接続（親経由で発音）
    return { ctx, gain, connected: null };
  },
```
evaluate 末尾（return 前）に:
```ts
    ctx.env?.captureSceneAudio?.(st.gain); // #172: このシーンの音声出力を通知
```
- [ ] **Step 4: テスト通過＋既存 audio テスト維持** — `... test audio` と tsc / PASS
- [ ] **Step 5: コミット** `#172 feat: AudioOutput を参照先シーン文脈対応（destination 非接続・captureSceneAudio）`

---

### Task 3: SceneInputNode に audio 出力

**Files:** Modify `nodes/SceneInputNode.ts` / Test `nodes/scene-input-node.test.ts`（追記）

- [ ] **Step 1: テスト追記**
```ts
test("audio 出力は env.sceneAudio を AudioSignal で返す", () => {
  const fakeNode = {} as AudioNode;
  const c = {
    timeSec: 0, input: () => undefined, param: (id: string) => (id === "sceneId" ? "B" : undefined),
    node: { id: "n", type: "SceneInput", params: { sceneId: "B" } },
    env: { sceneTexture: () => null, sceneAudio: (id: string) => (id === "B" ? fakeNode : null) },
  } as never;
  const out = SceneInputNode.evaluate(c);
  expect((out.audio as { node: AudioNode }).node).toBe(fakeNode);
});
test("出力ポートに texture と audio", () => {
  expect(SceneInputNode.outputs.map((p) => p.id)).toEqual(["texture", "audio"]);
});
```
- [ ] **Step 2: 失敗確認** — FAIL
- [ ] **Step 3: 実装** — import `SIGNAL_OUTPUT, signalOutput`（`../graph/audio-signal`）。outputs に `SIGNAL_OUTPUT` を追加。evaluate:
```ts
  evaluate: (ctx) => {
    const sid = ctx.param("sceneId");
    if (typeof sid !== "string" || sid === "") return {};
    const texture = ctx.env?.sceneTexture?.(sid) ?? undefined;
    const audioNode = ctx.env?.sceneAudio?.(sid) ?? null;
    return { texture, ...signalOutput(audioNode) };
  },
```
- [ ] **Step 4: テスト通過＋tsc** — PASS
- [ ] **Step 5: コミット** `#172 feat: SceneInput に audio 出力ポート`

---

### Task 4: ランタイム（sceneEnv・audioMerge・sceneAudio・restorer）

**Files:** Modify `graph/runtime.ts`

> WebAudio/WebGL 依存。tsc＋Playwright＋手動で確認。

- [ ] **Step 1: res に audio マージを追加**
`sceneRes` の値型に `audioMerge: GainNode; audioConnected: Set<AudioNode>` を追加。`ensureSceneRes` で `audioMerge: this.getAudioContext().createGain()`、`audioConnected: new Set()` を初期化。`sceneAudioCache: Map<string, AudioNode>` を追加。

- [ ] **Step 2: setSceneAssetRestorer 追加**
```ts
  private sceneAssetRestorer: ((node: NodeInstance, state: NodeState) => void) | null = null;
  /** #172: 参照先シーンの state 生成時にアセット（assetId）を復元する関数を設定する。 */
  setSceneAssetRestorer(fn: (node: NodeInstance, state: NodeState) => void): void { this.sceneAssetRestorer = fn; }
```
（`NodeInstance` import 追加。）

- [ ] **Step 3: sceneEnv(sceneId) を追加し、参照先評価/生成で使う**
```ts
  private sceneEnv(sceneId: string): NodeEnv {
    const res = this.ensureSceneRes(sceneId);
    return {
      ...this.env(),
      referencedScene: true,
      captureSceneAudio: (node) => {
        if (!res.audioConnected.has(node)) { try { node.connect(res.audioMerge); } catch { /* ignore */ } res.audioConnected.add(node); }
        this.sceneAudioCache.set(sceneId, res.audioMerge);
      },
    };
  }
```
`env()` に `sceneAudio: (id) => this.sceneAudioCache.get(id) ?? null` を追加（active/参照先双方で引けるよう base env に置く）。

- [ ] **Step 4: renderReferencedScenes / syncStatesFor を sceneEnv 使用に**
`renderReferencedScenes` の各シーン評価で `const env = this.sceneEnv(id);` を使い、`syncStatesFor(graph, res, env)` と `evaluate(graph, registry, { timeSec, env, state })` に渡す。`syncStatesFor` は env 引数を受け取り createState(env)/disposeState(state, env) に使う。state 新規生成時に restorer 呼び出し:
```ts
    for (const node of graph.nodes) {
      const def = this.registry.get(node.type);
      if (def?.createState && !res.states.has(node.id)) {
        const st = def.createState(env);
        res.states.set(node.id, st); res.defs.set(node.id, st !== undefined ? def : def);
        // #172: 参照先シーンの音声/動画入力をアセットから復元して解析・再生を走らせる
        if (def.fileInput && this.sceneAssetRestorer) {
          const sid = (node.params as Record<string, unknown>).assetId;
          if (typeof sid === "string" && sid !== "") this.sceneAssetRestorer(node, st);
        }
      }
    }
```
- [ ] **Step 5: res 破棄で audioMerge を切断**（renderReferencedScenes の破棄ループに `res.audioMerge.disconnect();`）。
- [ ] **Step 6: tsc＋全テスト** — 型なし/PASS
- [ ] **Step 7: コミット** `#172 feat: ランタイムで参照先シーンの音声を解析・捕捉し sceneAudio を供給`

---

### Task 5: main 配線（restorer）

**Files:** Modify `main.ts`

- [ ] **Step 1: restorer を設定**（wireSceneProvider 付近）:
```ts
runtime.setSceneAssetRestorer((node, state) => {
  const assetId = (node.params as Record<string, unknown>).assetId;
  if (typeof assetId !== "string" || !assetId) return;
  void library.getFile(assetId).then((f) => {
    if (f) void (state as FileLoadable).loadFile?.(f).catch((e) => console.warn(`[node-vj] scene asset restore failed ${node.id}:`, e));
  }).catch((e) => console.warn(`[node-vj] scene getFile failed ${assetId}:`, e));
});
runtime.resumeAudio(); // 参照先音声の start のため AudioContext を起こす（後続の操作でも resume される）
```
- [ ] **Step 2: tsc＋全テスト** — PASS
- [ ] **Step 3: コミット** `#172 feat: 参照先シーンのアセット復元を main で配線`

---

### Task 6: ビルド + Playwright スモーク + 手動

- [ ] **Step 1: ビルド** — `bun build .../node-vj.html --outdir /tmp/172-build --minify` / エラーなし
- [ ] **Step 2: Playwright スモーク** — SceneInput の outputs に audio がある／参照先シーンに AudioFileInput を置き SceneInput.audio を親 AudioOutput へ繋いで console/pageerror なし／フレーム前進。実音は手動。
- [ ] **Step 3: 手動確認**
```
lsof -ti tcp:3000 | xargs kill -9
bun run --cwd /Users/shun/dev/three-art/.worktrees/172-scene-node-audio dev:vj
```
確認: ①Scene1 に AudioFileInput＋音声駆動エフェクト＋Screen ②アセットを Scene1 のノードへ割当（assetId 登録）③Scene2 で SceneInput→Scene1 を参照し Screen へ→**Scene1 の映像が音に反応して動く**（A）④SceneInput.audio を Scene2 の AudioOutput へ繋ぐ→**Scene1 の音が鳴る**（B）。

---

## Self-Review
- **Spec coverage:** A=Task4,5（restorer）/ B=Task1,2,3,4（env・AudioOutput・SceneInput・runtime）。
- **Placeholder scan:** 各ステップ実コードあり。
- **Type consistency:** `referencedScene`/`captureSceneAudio`/`sceneAudio`/`setSceneAssetRestorer`/`signalOutput`/`SIGNAL_OUTPUT` を一貫使用。
- **要確認（実装時）:** AudioOutput.evaluate の return 形・既存 audio テストへの影響、runtime の既存 syncStatesFor シグネチャ変更（env 引数追加）に伴う呼び出し箇所、`NodeInstance` import。
