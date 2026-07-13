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

- シグナリングは **dev サーバの WS リレー（`/cf-signal`）＋ BroadcastChannel フォールバック**
  （下記「シグナリング transport」参照）。WebRTC 自体は同一マシン内で直接張られるため STUN は不要
  （`iceServers: []`・host candidate のみ）。
- 複数 viewer 対応: viewer ごとに RTCPeerConnection を 1 本張る（OBS ＋確認用ブラウザ等）。

## シグナリング transport（`clean-feed-transport.ts`）

> **改訂の経緯**: 当初はシグナリングを同一オリジンの BroadcastChannel のみで実装したが、
> **OBS のブラウザソースは OBS 内蔵の別ブラウザ（CEF）で動くため、BroadcastChannel が
> メインタブ（Chrome）へ届かない**ことが OBS 実機確認で発覚した（同一ブラウザ内 2 タブの
> E2E スモークでは検出できず）。WebRTC 自体はブラウザ間で問題なく張れるため、シグナリング
> だけを WS リレー経由へ切り替えた。

- **WS リレー（主経路）**: dev サーバ（scripts/vj-dev.ts）の `/cf-signal` に WS で接続する。
  リレーは受信メッセージを**送信元以外の全接続へそのまま転送**するだけ（中身は解釈しない・
  Bun の pub/sub `ws.publish`）。AI ブリッジの relay（vj-relay.ts・別ポート）とは別物。
  切断/接続失敗時は 3 秒間隔で自動再接続（`WsSignalTransport`）。
- **BroadcastChannel（フォールバック）**: WS エンドポイントが無い環境（静的 dist 配信等）でも
  同一ブラウザ内なら従来どおり動くよう併用する（`BroadcastChannelTransport`）。
- **publisher**: 両 transport を常時 listen し、返信（offer/ice/bye）は **hello が届いた
  transport** へ返す（viewer ごとに記録）。同一 viewerId の hello が両経路から届く場合に備え、
  「直近 1 秒以内の再 hello は無視」のデデュープを入れる（`HELLO_DEDUPE_MS`。viewer の再送
  間隔は 2 秒なので正規の再試行は落とさない）。
- **viewer**: hello/bye を**全 transport へ送り**、offer が届いた transport へ answer/ice を返す。
  WS が繋がらなければ BC 側だけが機能する＝自動フォールバック。WS transport は再接続を
  続けるため、dev サーバ再起動後の復帰も自動。

## シグナリングプロトコル（`clean-feed-protocol.ts`）

メッセージは transport に依らず共通（WS では JSON 文字列化して送る）。
BroadcastChannel のチャンネル名: `node-vj:clean-feed`（定数 `CLEAN_FEED_CHANNEL`）。

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

- `createPeerConnection()` / `createStream()` / `stopStream()` / `transports`（WS リレー + BC）
- hello 受信: 初回 viewer なら `createStream()`（captureStream 開始）→ PC 生成 → track 追加 →
  offer 送信（hello が届いた transport へ）。ICE は `cf:ice` で中継。
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

### エンコーダ設定（画質維持）

> **改訂の経緯**: OBS 実機確認で「プレビューを引き伸ばしたような」画質劣化が発覚。
> Chrome/CEF の WebRTC は既定のビットレート上限が低く（〜2.5Mbps 程度）、収まらない場合は
> 解像度を落とす（degradation の既定は balanced）。パーティクル系の高エントロピー映像では
> 1080p を維持できず 480p 相当までダウンスケールされていた。ローカル完結のため帯域制約は
> 気にしなくてよい。

publisher が hello ごとに映像トラック/sender へ以下を適用する:

- 映像トラックに `contentHint = "detail"`（fps より精細さを優先するヒント）
- 映像 sender の `RTCRtpSendParameters`:
  - `degradationPreference = "maintain-resolution"`（足りないときは解像度でなく fps を落とす）
  - `encodings[].maxBitrate = CLEAN_FEED_MAX_BITRATE`（40Mbps・定数エクスポート）
- negotiation 前の `setParameters` が失敗/無効な環境向けの防御として、
  `connectionState "connected"` 後にも再適用する。
- captureStream は `onViewersChange`（親が描画解像度を 1920×1080 へ引き上げる）より**後**に
  開始する（ユニットテストで順序を検証）。
- E2E（別ブラウザ構成）では受信側 video が 1920×1080 に到達し、10 秒後も維持されることを assert
  する（ダウンスケールは時間経過で起きるため）。

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
- `/cf-signal` → クリーンフィードのシグナリング用 WS リレー（上記「シグナリング transport」）。
- `bun run dev:vj [port]` / `scripts/vj-bridge-up.ts` はこのスクリプトを起動する（既定 port 3000）。
- `bun build` には `./obs.html` を追加（dist では静的に `/obs.html` で配られる。ただし WS リレーが
  無いため OBS＝別ブラウザへの配信は dev サーバ経由が前提。同一ブラウザ内は BC で動く）。

ツールバー（コントロールパネル「出力・録画」）にクリーンフィード URL
（`location.origin + "/obs.html"`）をコピーするボタンを追加し、接続中 viewer 数をラベルに出す。

## テスト

1. protocol 純関数（parse の網羅）
2. transport（WsSignalTransport を WS/タイマ fake 注入）: JSON 送受・不正 JSON 無視・
   切断後の自動再接続・close 後は再接続しない
3. publisher の viewer 管理（RTC/transport/stream を fake 注入）: hello→offer、複数 viewer、
   二重 hello、bye/切断での片付け、0 人で stream 停止、dispose、
   **返信は hello が届いた transport へ**・**二重 hello（両経路）の 1 秒デデュープ**
4. viewer のステートマシン（fake 注入): hello 再送（全 transport へ）、offer→answer（届いた
   transport へ返信＝BC フォールバック）、ontrack、切断→再試行
5. Playwright E2E スモーク（port 3172・終了時停止）: メインタブと /obs.html を**別々のブラウザ
   インスタンス**で開き（＝BroadcastChannel が届かない OBS 相当の再現）、WS リレー経由で
   obs 側 video に映像が流れる（videoWidth > 0・currentTime 前進）ことを確認
