# #152 シーンをノードとして扱う機能（Phase 1: テクスチャ合成＋循環防止）設計

- Issue: https://github.com/mishi5/three-art/issues/152 （Epic #56・#151 の発展）
- 依存: #151 シーン管理（SceneManager / Scene / SceneStore・マージ済み）

## 目的
シーンを 1 つのノード（`SceneInput`）として別シーンのグラフから参照し、その最終映像（Screen 出力テクスチャ）を入力として合成できるようにする。シーン間の循環参照（無限ループ）を親子関係グラフで検出・禁止する。

## スコープ（ユーザ合意）
- **Phase 1（本設計・本 PR）**: シーンの**テクスチャ**出力＋循環防止＋UI。映像のみ。
- **Phase 2（別 PR/Issue）**: シーン横断の**音声 signal 出力**＋親グラフでの Mix。トランジションも非スコープ。
- Phase 1 では参照先シーンの音声入力は start しないため**無音**（音声は Phase 2）。

## 全体方針：ランタイムで参照先シーンを事前評価（採用案 A）
単一 renderer を共有しつつ、アクティブグラフ評価の前に参照先シーンを依存順で評価し、各シーンの合成テクスチャをキャッシュする。`SceneInput.evaluate` はキャッシュを読むだけ。重複参照のデデュープ・依存順がランタイム 1 箇所で完結する。

## データフロー（1 フレーム）
1. ランタイムが**アクティブグラフから到達する参照先シーン**を依存順（leaf→）に列挙（`sceneRenderOrder`）。
2. 各参照先シーンについて: シーン専用 state マップで `syncStates` → `evaluate(refGraph, { state, env })` → `pickScreenTextures` を**シーン専用 RT** へ blit → `sceneId → RT.texture` をキャッシュ。入れ子の `SceneInput` は依存順により解決済み（env 経由でキャッシュ参照）。
3. env に `sceneTexture(id): THREE.Texture | null` を提供。
4. アクティブグラフを評価（`SceneInput.evaluate` が `env.sceneTexture(sceneId)` を返す）。
5. 参照されなくなったシーンの state/RT を破棄。

## コンポーネント

### `nodes/SceneInputNode.ts`（新規）
```ts
// category: "input", sceneInput: true
// outputs: [{ id: "texture", type: "texture" }]
// params: [{ id: "sceneId", kind: "string", default: "", hidden: true }]
// evaluate: (ctx) => ({ texture: ctx.env?.sceneTexture?.(ctx.param("sceneId")) ?? undefined })
```
registry に登録（input カテゴリ）。

### `scene/scene-refs.ts`（新規・純関数・テスト対象）
```ts
collectSceneRefs(graph: GraphDoc, registry: NodeRegistry): string[];
// SceneInput ノードの params.sceneId（非空）を集める

wouldCreateSceneCycle(
  scenes: ReadonlyArray<{ id: string; graph: GraphDoc }>,
  registry: NodeRegistry, fromSceneId: string, toSceneId: string,
): boolean;
// 全シーンの「シーン→参照シーン」有向グラフ＋追加辺(from→to)を作り DFS。
// from===to（自己参照）も true。

sceneRenderOrder(
  activeSceneId: string,
  scenes: ReadonlyArray<{ id: string; graph: GraphDoc }>,
  registry: NodeRegistry,
): string[];
// activeSceneId から到達する参照先シーンを依存順（leaf 先）で返す（active 自身は含めない）。
// 循環は防止済みだが、訪問中集合で保険検出し循環辺は無視。
```

### `graph/node-type.ts`（変更）
- `NodeEnv` に `sceneTexture?(sceneId: string): unknown;` を追加（visual/sink 用環境）。
- `NodeTypeDef` に `sceneInput?: boolean;` を追加（ノードに「シーン選択行」を出す目印。fileInput と同様）。
- `ParamDef.hidden` は #151 で追加済み（再利用）。

### `graph/runtime.ts`（変更）
- `setSceneProvider(fn: (id: string) => GraphDoc | null): void` を追加（main が SceneManager に配線）。
- シーン専用の `Map<sceneId, { states: Map<nodeId, NodeState>; stateDefs: Map; rt: THREE.WebGLRenderTarget }>` を保持。
- `tick` 冒頭で、`sceneProvider` と現在のアクティブ graph から `sceneRenderOrder` を求め、各参照先シーンを評価して RT へ合成し `sceneTextureCache: Map<sceneId, THREE.Texture>` を更新。`env()` が `sceneTexture(id)` でキャッシュを返す。
- 参照されなくなったシーンの states/RT を破棄。
- ※ アクティブシーン自身は従来どおり評価・canvas 転写。参照先は RT 止まり（canvas へは出さない）。

### editor（変更・`NodeEditor.ts` / `editor/layout.ts`）
- `layout.ts`: `hasSceneRow(def)`（`!!def.sceneInput`）と `sceneRowRect(node, def)`、`nodeHeight` への 1 行加算。
- `NodeEditor`: sceneInput ノードに「シーン選択行」を描画（参照中シーン名 or「(シーン未選択)」）。クリックで**有効シーンのドロップダウン**（既存 `buildMenu` を再利用）を開く。選択コールバック経由で sceneId を設定。
- コンストラクタに任意の `sceneSelect` コールバック群を追加（`loadFileIntoNode`/`playback` と同パターン）:
  ```ts
  sceneSelect?: {
    options(nodeId: string): { id: string; name: string }[]; // 循環になる候補は除外済み
    current(nodeId: string): string | null;                  // 現在の参照シーン名表示用
    choose(nodeId: string, sceneId: string): void;
  }
  ```

### `main.ts`（変更）
- `runtime.setSceneProvider((id) => sceneManager.list().find((s) => s.id === id)?.graph ?? null)`。
  - 注: アクティブシーンの「最新編集」は共有 `graph`。`sceneProvider` がアクティブ id を要求された場合は共有 `graph` を返す（編集中の内容で自己/相互参照の評価が最新になる）。
- editor の `sceneSelect` を SceneManager＋`wouldCreateSceneCycle` に配線（options は循環候補と自身を除外、choose は sceneId param を設定）。
- SceneInput ノードもファイル入力ノードと同様、グラフ保存（serialize）で `sceneId` が round-trip する（params 永続化・既存機構）。

## エラー処理・端ケース
- 参照先シーンが存在しない（削除された）: `sceneTexture` は null → SceneInput.texture は undefined（黒/未接続扱い）。UI は「(不明なシーン)」表示。
- 循環: UI で候補から除外＋ choose 時に再チェックで拒否（toast）。ランタイムの `sceneRenderOrder` も訪問中集合で保険。
- 深さ: 防止済み DAG なので有限。実用上の負荷（多数ネスト）は警告に留め制限しない。

## テスト
- `scene-refs.test.ts`: collectSceneRefs / wouldCreateSceneCycle（直接・間接・自己）/ sceneRenderOrder（依存順・到達のみ・循環保険）。
- `SceneInputNode` 単体: evaluate が `env.sceneTexture` を引く（スタブ env）。
- layout: `hasSceneRow`/`sceneRowRect`/`nodeHeight`（純関数）。
- ランタイムのシーン事前評価・editor の選択行・実描画は Playwright スモーク＋手動（DOM/WebGL 依存）。

## ファイル構成
- 追加: `nodes/SceneInputNode.ts`、`scene/scene-refs.ts`(+test)
- 変更: `graph/node-type.ts`、`graph/runtime.ts`、`editor/layout.ts`(+test)、`editor/NodeEditor.ts`、`nodes/registry.ts`、`main.ts`

## スコープ外（Phase 2）
シーン横断の音声 signal 出力・親 Mix、トランジション/クロスフェード、参照先シーンの音声発音。
