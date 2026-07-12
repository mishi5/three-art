# #283 クリーンフィード（OBS ブラウザソース向け WebRTC ミラー）設計

対象 Issue: https://github.com/mishi5/three-art/issues/283 （親: https://github.com/mishi5/three-art/issues/274 ）

## 目的

UI の乗っていないライブ出力（クリーンフィード）を OBS のブラウザソースへ取り込めるようにする。
メインタブの出力 canvas をそのまま専用ページ（`/obs.html`）へミラーし、OBS はそのページを
ブラウザソースとして読み込むだけでよい。

## 方式選定

| 方式 | 概要 | 判断 |
| --- | --- | --- |
| WebRTC ミラー（採用） | 出力 canvas の `captureStream()` を RTCPeerConnection で専用ページへ配信 | 実装が薄く、描画は既存ランタイム 1 箇所のまま。遅延も実用域（同一マシン・host candidate のみ） |
| 別レンダリング | /obs.html 側でグラフを再評価して描画 | 状態（動画シーク・音声・カメラ）の二重化が必要で非現実的 |

- シグナリングは同一オリジンの **BroadcastChannel**。同一マシン完結のためシグナリングサーバも STUN も不要
  （`iceServers: []`・host candidate のみ）。
- 複数 viewer 対応: viewer ごとに RTCPeerConnection を 1 本張る（OBS ＋確認用ブラウザ等）。

## シグナリングプロトコル（`clean-feed-protocol.ts`）

チャンネル名: `node-vj:clean-feed`（定数 `CLEAN_FEED_CHANNEL`）。

| メッセージ | 方向 | 意味 |
| --- | --- | --- |
| `{ type: "cf:hello", viewerId }` | viewer→pub | 接続要求。未接続の間は 2 秒間隔で再送（publisher 出現待ち／リロード追従） |
| `{ type: "cf:offer", viewerId, sdp }` | pub→viewer | SDP offer |
| `{ type: "cf:answer", viewerId, sdp }` | viewer→pub | SDP answer |
| `{ type: "cf:ice", viewerId, from: "pub"\|"viewer", candidate }` | 双方向 | ICE candidate 中継 |
| `{ type: "cf:bye", viewerId }` | 双方向 | どちらかの終了（pub 終了時は接続中 viewer ぶん送る） |

`parseCleanFeedMessage(raw: unknown)` が検証付きパース（不正は null）を行う。viewer は自分の
`viewerId` 宛て以外を無視する。二重 `cf:hello`（viewer リロード等）は既存 PC を破棄して張り直す。

## publisher（`clean-feed.ts` / メインタブ）

`CleanFeedPublisher` は依存注入（ClipLauncher の `ClipMediaDeps` パターン）:

- `createPeerConnection()` / `createStream()` / `stopStream()` / `channel`（BroadcastChannel 互換）
- hello 受信: 初回 viewer なら `createStream()`（captureStream 開始）→ PC 生成 → track 追加 →
  offer 送信。ICE は `cf:ice` で中継。
- viewer の bye／connectionState "failed"・"disconnected"・"closed" で当該 PC を破棄。
  viewer が 0 になったら `stopStream()`。
- `onViewersChange` で親（main.ts）へ通知。

### keepAlive / outputActive 連携（main.ts）

出力 canvas は `outputActive` のときだけ毎フレーム更新されるため、viewer が 1 人でもいる間は
既存の OR 合成へ 1 項追加して維持する:

- `syncKeepAlive()`: `output.isOpen() || screenOutputs.anyOpen() || cleanFeed.hasViewers()`
- `runtime.setOutputActive(output.isOpen() || cleanFeed.hasViewers())`（`syncOutputActive()` に集約）
- `applyPreviewSize()`: viewer がいる間は高解像度（1920×1080）で描く（既存の出力ウィンドウ・録画と同様）
- 録画停止時（`setRecording(false)` は録画前の outputActive を復元する）にも `syncOutputActive()` を
  呼び、録画中に viewer が現れたケースでフィードが止まらないようにする。
- `pagehide` で `dispose()`（bye 送信・PC/stream 片付け）。

### 音声

**音声トラックも WebRTC に載せる（採用）。** 録画（#179）と同じ経路
`runtime.getRecordingStream(fps, true)` を使う。`AudioOutput` ノードは常時
`recordingDestination`（keep-alive ConstantSource 付き）へ分岐接続しているため、追加の配線なしで
音声トラックを取り出せる。注意: 音声トラックは録画と**同一トラック**の共有なので、クリーンフィード
の片付けでは **video トラックのみ stop** する（`stopStream` の実装で担保）。

## viewer（`obs.html` ＋ `obs-main.ts` / `clean-feed-viewer.ts`）

- UI なし・黒背景・`<video autoplay muted playsinline>` 全画面（object-fit: contain）。
  接続待ちの間だけ控えめなステータステキストを出し、接続したら消す。
- `CleanFeedViewer`: 起動時と切断時に `cf:hello` を 2 秒間隔で送信。offer 受信で PC を（あれば
  破棄して）生成 → answer 返信 → ontrack で `video.srcObject` へ。
- 切断（connectionState failed/disconnected/closed・pub の bye）で PC を破棄し hello 再送へ戻る
  （メインタブのリロードにも追従）。
- `muted` は autoplay 許可のため。OBS のブラウザソースは「ページの音声を OBS で制御する
  （Control audio via OBS）」を有効にすればページ内の WebRTC 音声を取り込める（video.muted でも
  OBS 側のキャプチャには乗る）。手順は docs/obs-integration.md に記載。

## 配信方法（dev サーバ / ビルド）

Bun の HTML dev サーバは複数 HTML を渡すとルート名がファイル名になり（`/node-vj`・`/obs`）、
既存の `http://localhost:3000/` が 404 になってしまう。既存 URL を壊さないため、明示ルートの
dev サーバスクリプト `scripts/vj-dev.ts` を追加する:

- `/`（と `/node-vj`）→ node-vj.html、`/obs.html`（と `/obs`）→ obs.html
- `bun run dev:vj [port]` / `scripts/vj-bridge-up.ts` はこのスクリプトを起動する（既定 port 3000）。
- `bun build` には `./obs.html` を追加（dist では静的に `/obs.html` で配られる）。

ツールバー（コントロールパネル「出力・録画」）にクリーンフィード URL
（`location.origin + "/obs.html"`）をコピーするボタンを追加し、接続中 viewer 数をラベルに出す。

## テスト

1. protocol 純関数（parse の網羅）
2. publisher の viewer 管理（RTC/チャンネル/stream を fake 注入）: hello→offer、複数 viewer、
   二重 hello、bye/切断での片付け、0 人で stream 停止、dispose
3. viewer のステートマシン（fake 注入): hello 再送、offer→answer、ontrack、切断→再試行
4. Playwright E2E スモーク（port 3171・終了時停止）: メインタブ＋ /obs.html を同一ブラウザで開き、
   obs 側 video に映像が流れる（videoWidth > 0・currentTime 前進）ことを確認
