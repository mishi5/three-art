---
name: node-vj-api
description: node-vj（ノードベース VJ アプリ）を AI/スクリプトから操作するとき（グラフの読取・構築・パラメータ変更・シーン切替・状態確認）に使う。window.nodeVj.api と postMessage の操作方法・YAML 形式・検証ループを定義する。
---

# node-vj AI 操作 API（#177）

node-vj は `window.nodeVj.api`（型付きコマンド API）と postMessage 受け口を常時公開している。
ブラウザ経由（Playwright / DevTools コンソール）でこの API を叩けば、UI 操作なしでグラフを読取・構築できる。

詳細設計・プロトコル仕様: `docs/plans/2026-07-04-177-ai-api-design.md`（ADR）
実装: `src/apps/node-vj/api/ai-api.ts` / `src/apps/node-vj/api/post-message-bridge.ts`

## 前提: サーバ起動と接続

- dev サーバ: `bun run --cwd <リポジトリ or worktree> dev:vj`（既定 port 3000。使用中なら空きポートで）
- Playwright から叩く: `env -u NODE_OPTIONS uv run --with playwright …` で page を開き `page.evaluate(() => window.nodeVj.api.…)`
- **実カメラ・マイクを自動で起動しない**（fake-ui フラグは実機カメラを無断許可する）。CameraInput/MicInput の実動作はユーザの手動確認に委ねる。

## API コマンド一覧

すべて同期・戻り値は JSON セーフな `{ ok: true, ... }`、失敗は `{ ok: false, error }`。

| コマンド | 戻り値 | 用途 |
|---|---|---|
| `getNodeCatalog()` | `{ ok, version, nodes: [{ type, category, description, inputs, outputs, params }] }` | **最初に読む**。全ノードの仕様書（ポート型・param の kind/min/max/options）。グラフ YAML を書くための唯一の参照 |
| `getGraphYaml()` | `{ ok, yaml }` | 現在のグラフを YAML で取得（version 値の取得にも使う） |
| `getScenes()` | `{ ok, scenes: [{ id, name, active, output }] }` | シーン一覧 |
| `getStatus()` | `{ ok, activeSceneId, outputSceneId, nodeCount, nodes: [{ id, type, outputs }] }` | 直近評価のスナップショット。number/boolean/string はそのまま、テクスチャ等は型名文字列 |
| `applyGraphYaml(yaml)` | `{ ok, warnings: string[] }` | グラフを YAML で**丸ごと差し替え**。History に積まれ Cmd+Z で取消可 |
| `setParam(nodeId, paramId, value)` | `{ ok }` | パラメータ 1 個の変更（min/max クランプ・enum 検証つき）。ライブ操作向け |
| `switchScene(sceneId)` | `{ ok }` | アクティブシーン切替 |

## postMessage（別コンテキスト/拡張から）

```js
window.postMessage({ type: "node-vj:cmd", id: "任意ID", cmd: "getScenes", args: {} }, location.origin);
// 返信: { type: "node-vj:result", id, result } が送信元へ届く（同一オリジン限定）
```

cmd 名・args は API と同一（`applyGraphYaml` は `args: { yaml }`、`setParam` は `args: { nodeId, paramId, value }`）。

## グラフ YAML の形式（applyGraphYaml に渡すもの）

```yaml
version: 1            # 必須。getGraphYaml() の先頭行から現在値を取得して合わせる
nodes:
  - id: n1            # グラフ内で一意な任意文字列
    type: Number      # getNodeCatalog() にある type のみ
    params: { value: 0.7 }   # 省略した param は default で補完される
    position: { x: 60, y: 120 }
connections:
  - id: c1
    from: { node: n1, port: out }
    to: { node: n2, port: a }
```

- ポート型が一致する接続のみ有効（型・循環・重複は読込時に自動で捨てられ warnings に載る）
- 画面に出すには visual 系の texture 出力を `Screen` ノードへ接続する

## 推奨ワークフロー（構築 → 検証ループ）

1. `getNodeCatalog()` でノード仕様を取得
2. YAML を組み立てて `applyGraphYaml(yaml)` → **`warnings` が空であることを必ず確認**（未知ノード・不正接続はここに出る。ok:true でも warnings があれば意図とズレている）
3. `getStatus()` で評価値（number 出力など）を読み、期待値と突き合わせて検証
4. 微調整は `setParam`（丸ごと差し替えより軽く、変更なしなら履歴も汚さない）

## 注意

- `applyGraphYaml` は現在のグラフを**完全に置き換える**。ユーザのグラフを壊す操作になりうるので、実行前に `getGraphYaml()` で退避するか、Cmd+Z（History）で戻せることを伝える
- アクティブシーンは 5 秒ごとに localStorage へ自動保存される。壊れた状態を放置しない（すぐ undo か正しいグラフを適用）
- `window.nodeVj` の他メンバ（graph/runtime/editor 等）は debug 用の生オブジェクト。操作は必ず `api` 経由で行う（検証・History・サニタイズを通すため）
