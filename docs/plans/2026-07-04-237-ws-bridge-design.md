# #237 AI 操作の WebSocket ブリッジ（v2・ローカル中継）設計

Issue: https://github.com/mishi5/three-art/issues/237

## ステータス

採用（実装）

## コンテキスト

#177（v1: `window.nodeVj.api`＋postMessage）はブラウザ内のコンテキストからしか叩けない。
外部プロセスの AI エージェント（Claude Code 等）が、Playwright/CDP なしで**ユーザが普段
見ているタブ**のグラフを操作できるようにする。v1 の ADR（`2026-07-04-177-ai-api-design.md`）
で「v2: WebSocket ブリッジ」として言及済みの構成をそのまま実装する。

```
[node-vj タブ] --ws--> [ローカル中継 (127.0.0.1)] <--ws-- [AI エージェント]
```

- フロントが WS **クライアント**として中継へ接続する（ページのホスト先を問わない。
  `ws://localhost` への接続は信頼できるコンテキスト扱い）。
- クラウド中継（wss・リモート操作）はスコープ外（将来拡張）。

## 決定

### プロトコル（v1 と完全同一＋hello）

- 接続直後に役割宣言: `{ type: "node-vj:hello", role: "app" | "agent" }`
- コマンド: `{ type: "node-vj:cmd", id, cmd, args? }`（v1 の postMessage と同形）
- 結果: `{ type: "node-vj:result", id, result }`（同上）

フロント側は受信 cmd を既存の `parseCommandMessage` / `dispatchCommand`
（`api/post-message-bridge.ts`）へそのまま流す＝コマンド検証・dispatch は v1 を再利用し、
新規実装は「接続管理」だけに絞る。

### 中継サーバ（dumb pipe）

`scripts/vj-relay.ts`（`bun run relay`）。Bun.serve の WebSocket。機能を持たない純粋な中継。

- **127.0.0.1 バインドのみ**。port は第 1 引数 or 環境変数 `VJ_RELAY_PORT`（既定 8787）。
- ルーティング（純関数化: `src/apps/node-vj/api/relay-router.ts` の `RelayRouter`）:
  - hello で役割を登録。**app は最後に hello した 1 本のみ有効**（タブ再読込で自然に差し替わる）。
  - `node-vj:cmd` → app へ**原文のまま**転送。app 不在（または送信元が app 自身）なら送信元へ
    `{ type: "node-vj:result", id, result: { ok: false, error: "app not connected" } }` を返す。
  - `node-vj:result`（現 app からのみ受理）→ **全 agent へ**原文のまま転送（agent は id で自分の
    応答を拾う。宛先管理を持たない分だけ中継が単純になる）。
  - hello 前のクライアント・未知 type・不正 JSON は黙って無視。
  - 切断時は登録を掃除（app 切断で「app not connected」に戻る）。

### フロント側 WS クライアント

`src/apps/node-vj/api/ws-bridge-client.ts` の `WsBridgeClient`。

- 接続状態機械（純関数 `nextStatus`）: `disabled → connecting → connected → retrying`
  - enable: disabled → connecting / disable: 任意 → disabled
  - opened: connecting → connected / closed: disabled 以外 → retrying
  - retry（タイマ発火）: retrying → connecting
- open で `hello role:"app"` を送信。切断・接続失敗は **3s 間隔で自動リトライ**。
- **中継が居なくてもアプリは通常動作**: 接続失敗は静かに（console へエラーを流さない。
  socket 生成の throw も retrying へ落とすだけ）。
- WebSocket・タイマは注入可能（`createSocket` / `setTimeoutFn`）にしてフェイクでテスト。
- URL 変更・ON/OFF は `setConfig({ enabled, url })` で即時反映（URL 変更時は張り直し）。

### prefs＋設定パネル

- `prefs.ts`（#229 の追加手順どおり）:
  - `wsBridgeEnabled: boolean`（既定 **false**。opt-in。postMessage と違い外部プロセスへ口を
    開くため既定 OFF にする）
  - `wsBridgeUrl: string`（既定 `"ws://localhost:8787"`。検証は「空でない string」のみ）
- `editor/settings-panel.ts` に「AI ブリッジ」セクション: ON/OFF トグル・URL 入力・接続状態表示
  （無効/接続中…/接続済/再接続待ち。1s ポーリングで更新）。切替は即時反映。
- `main.ts` が配線: `createAiApi` の api を `WsBridgeClient` にも渡し、prefs 変更時に
  `setConfig` を呼ぶ（settings-panel の actions は #229 と同じ「main が配線」構成）。

### セキュリティ

- 中継は 127.0.0.1 バインドのみ（LAN からは接続不可）。
- フロントは既定 OFF（設定パネルで明示的に有効化）。
- コマンドは v1 と同じ検証・History 経路を通る（誤操作は Cmd+Z で戻せる）。

## 実装

```
scripts/
├── vj-relay.ts                       … 中継サーバ本体（Bun.serve。ルーティングは relay-router へ委譲）
└── vj-agent-example.ts               … agent 側サンプル（hello→cmd→result 待ち）
src/apps/node-vj/api/
├── relay-router.ts                   … 中継ルーティング（純ロジック・接続トークン総称型）
├── relay-router.test.ts
├── ws-bridge-client.ts               … フロント側 WS クライアント＋接続状態機械
└── ws-bridge-client.test.ts
src/apps/node-vj/prefs.ts             … wsBridgeEnabled / wsBridgeUrl 追加
src/apps/node-vj/editor/settings-panel.ts … 「AI ブリッジ」セクション
src/apps/node-vj/main.ts              … 配線（aiApi → WsBridgeClient・prefs 反映）
package.json                          … "relay": "bun ./scripts/vj-relay.ts"
.claude/skills/node-vj-api/SKILL.md   … WS ブリッジ経由の操作手順を追記
```

## テスト

- `relay-router.test.ts`: 役割登録・cmd→app 転送（原文のまま）・result→全 agent 転送・
  app 差し替え（最後の hello が有効）・app 不在時のエラー返信・切断掃除・不正入力の無視。
- `ws-bridge-client.test.ts`: `nextStatus` の遷移表・hello 送信・cmd 受信→dispatch→result
  返信（v1 プロトコル互換）・不正メッセージの静かな無視・自動リトライ・disable/URL 変更の
  即時反映（フェイク socket / フェイクタイマ注入）。
- `prefs.test.ts`: 既定値・読取・不正値フォールバック（#229 の形に追随）。

## 手動確認 / E2E スモーク

1. `bun run relay`（既定 8787）
2. node-vj を開き、設定パネル「AI ブリッジ」を ON（URL 既定のまま）→「接続済」表示
3. `bun scripts/vj-agent-example.ts getStatus` で result が返る

Playwright スモークでは relay を 8791・dev サーバを 3500 で起動し、`localStorage` の
`node-vj.prefs.v1` に `{ wsBridgeEnabled: true, wsBridgeUrl: "ws://localhost:8791" }` を
仕込んだ headless ページで getScenes / applyGraphYaml / getStatus の往復を確認する。
