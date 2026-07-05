# #245 AI 操作 API: シーン管理コマンド追加 設計

Issue: https://github.com/mishi5/three-art/issues/245

## コンテキスト

AI 操作 API（#177 / #237）はシーンの読取（`getScenes`）と切替（`switchScene`）しか持たず、
シーンの作成・改名・削除・出力ピン留めは UI（シーンパネル）操作が必要だった。
外部エージェントが「新シーンを作って→グラフを構築して→出力を切り替える」一連の操作を
UI なしで完結できるよう、シーン管理コマンドを追加する。

## 決定

- `createAiApi(hooks)` に 4 コマンドを追加する: `addScene` / `renameScene` / `removeScene` / `setOutputScene`。
- **hooks は main.ts の既存 `sceneActions`（ScenePanelActions）を再利用**する。
  シーンパネルの「＋」「改名」「削除」「出力ピン」とまったく同じクロージャを通すため、
  snapshot → sceneManager 操作 → `reflectActiveScene` → カメラ自動停止判定（#214）→
  `syncOutputScene`（#174）の副作用が UI と完全に一致する。sceneManager 直叩きはしない。
- そのために `ScenePanelActions.add` のシグネチャを `add(name?: string): Scene` に変更する
  （UI 側は従来どおり `actions.add()` で呼ぶだけ。戻り値の Scene は API が id を取るために使う）。
- 入力検証（id 存在・name 非空・最後の 1 枚拒否）は **ai-api.ts 側で行う**。
  sceneManager は不在 id や最後の 1 枚を「静かに no-op / フォールバック」するため、
  API としては `{ ok: false, error }` を明示的に返す必要がある（既存 `switchScene` と同じ方針）。
- `dispatchCommand`（post-message-bridge.ts）に 4 コマンドの args 検証＋振り分けを追加する。
  postMessage 受け口と WS ブリッジ（ws-bridge-client.ts）は両方 `dispatchCommand` を通るため、
  ここに足すだけで **3 経路（window.nodeVj.api / postMessage / WS）すべてで使える**。

## API 仕様

| cmd / メソッド | args | 結果 |
| --- | --- | --- |
| `addScene(name?)` | `{ name?: string }` | `{ ok: true, sceneId }` — 空シーンを作成してアクティブ化（シーンパネルの「＋」と同経路）。name 省略時は `Scene N`。name は trim され、空白のみはエラー |
| `renameScene(sceneId, name)` | `{ sceneId, name }` | `{ ok: true }` — name は trim（UI のダブルクリック改名と同じ）。不在 id / 空 name はエラー |
| `removeScene(sceneId)` | `{ sceneId }` | `{ ok: true }` — 最後の 1 枚は `{ ok: false, error }`。アクティブ削除時のフォールバック（隣のシーンへ）・出力ピン先削除時の追従（null）復帰は UI と同挙動 |
| `setOutputScene(sceneId \| null)` | `{ sceneId: string \| null }` | `{ ok: true }` — 出力シーンのピン留め。`null` で解除（編集に追従）。不在 id はエラー。args の `sceneId` キーは必須（null を明示させる） |

## hooks の形（AiApiHooks.scenes 追加分）

```ts
scenes: {
  // 既存: list / activeId / outputId / switchTo
  add(name?: string): string;          // 新シーン作成→アクティブ化して id を返す（sceneActions.add）
  rename(id: string, name: string): void;
  remove(id: string): void;            // 存在検証・最後の1枚拒否は ai-api 側で済ませてから呼ぶ
  setOutput(id: string | null): void;  // sceneActions.setOutput（syncOutputScene 込み）
}
```

## テスト

- `ai-api.test.ts`: ステートフルなフェイク scenes フックで addScene（sceneId 返却・name 指定/省略/空白のみ）・
  renameScene（trim・不在 id・空 name）・removeScene（成功・最後の 1 枚拒否・不在 id）・
  setOutputScene（ピン留め・null 解除・不在 id）。
- `post-message-bridge.test.ts`: dispatchCommand の 4 コマンド振り分け・args 不正
  （name 型不正・sceneId 欠落/型不正・setOutputScene の sceneId キー必須と null 許可）。
- E2E スモーク（Playwright headless・自前ポート）: `addScene` → `applyGraphYaml` → `getScenes`/`getStatus`
  で UI 操作なしに新シーンへグラフが構築されることを確認する。
