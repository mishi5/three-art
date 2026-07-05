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
| `addScene(name?)` | `{ ok, sceneId }` | 新規シーンを作成してアクティブ化（シーンパネルの「＋」と同経路）。name 省略時は `Scene N`。続けて `applyGraphYaml` すれば UI なしで新シーンにグラフを構築できる |
| `renameScene(sceneId, name)` | `{ ok }` | シーン改名（name は trim・空はエラー） |
| `removeScene(sceneId)` | `{ ok }` | シーン削除。最後の 1 枚は `{ ok: false, error }`。アクティブ削除時は隣のシーンへフォールバック（UI と同挙動） |
| `setOutputScene(sceneId \| null)` | `{ ok }` | 出力シーンのピン留め。`null` で解除（編集に追従）。不在 id はエラー。postMessage/WS では `args: { sceneId }` キー必須（null を明示） |

## postMessage（別コンテキスト/拡張から）

```js
window.postMessage({ type: "node-vj:cmd", id: "任意ID", cmd: "getScenes", args: {} }, location.origin);
// 返信: { type: "node-vj:result", id, result } が送信元へ届く（同一オリジン限定）
```

cmd 名・args は API と同一（`applyGraphYaml` は `args: { yaml }`、`setParam` は `args: { nodeId, paramId, value }`）。

## WS ブリッジ経由（v2・#237）— ブラウザ操作なしで外部プロセスから叩く

ユーザが普段見ているタブを Playwright/CDP なしで直接操作できる経路。プロトコル（cmd 名・args・結果形）は postMessage と完全同一。

```
[node-vj タブ] --ws--> [ローカル中継 (127.0.0.1)] <--ws-- [AI エージェント]
```

設計: `docs/plans/2026-07-04-237-ws-bridge-design.md` / 実装: `scripts/vj-relay.ts`・`src/apps/node-vj/api/ws-bridge-client.ts`

### 手順

1. **一式を起動**: `bun run bridge:up [devPort] [relayPort]`（既定 3000/8787。中継＋dev サーバをバックグラウンド起動し PID を dev ポート単位で記録、macOS ではブラウザでページまで自動で開く（`--no-open` で抑止）。**同じ dev ポートの記録済みセットは自動で停止して入れ替える**（worktree を移って起動し直すと古いサーバが自動で消える）。**PID 記録の無いサーバが対象ポートを使用中なら触れずに中止**する。ポートを変えれば複数セット同時起動も可）。停止は `bun run bridge:down`（記録した全セット）/ `bun run bridge:down <devPort>`（そのセットのみ）。中継単体なら `bun run relay`（127.0.0.1:8787。port は第 1 引数 or 環境変数 `VJ_RELAY_PORT`）
2. **node-vj 側で有効化**: 設定パネル（サイドドック歯車）→「AI ブリッジ」→ ON（既定 OFF・URL 既定 `ws://localhost:8787`）。「接続済」表示になれば OK。設定は prefs（localStorage `node-vj.prefs.v1` の `wsBridgeEnabled` / `wsBridgeUrl`）に保存される
3. **agent 側から接続**: 中継へ WS 接続し、まず `{ type: "node-vj:hello", role: "agent" }` を送る。以後 `{ type: "node-vj:cmd", id, cmd, args? }` を送ると `{ type: "node-vj:result", id, result }` が返る（result は全 agent へ配られるので **id で自分宛を拾う**）。app（タブ）不在時は `{ ok: false, error: "app not connected" }` が即返る

### サンプルスクリプト（そのまま使える）

```bash
bun scripts/vj-agent-example.ts getStatus
bun scripts/vj-agent-example.ts setParam '{"nodeId":"n1","paramId":"value","value":0.5}'
bun scripts/vj-agent-example.ts --url ws://127.0.0.1:8791 applyGraphYaml '{"yaml":"version: 1\n..."}'
```

終了コード: 0 = `ok:true` / 1 = `ok:false` / 2 = 接続失敗・5s タイムアウト。

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
