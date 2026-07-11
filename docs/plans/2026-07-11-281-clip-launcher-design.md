# #281 ClipLauncher（映像クリップランチャー）設計

対象 Issue: https://github.com/mishi5/three-art/issues/281 （親: #274）

## 概要

SamplePad（音声ワンショット）の映像版 `ClipLauncher` ノードを新設する。
4×4 パッドに動画/画像アセットを割り当て、パッド押下で texture 出力をそのクリップへ切り替える。

- **パッド機構は SamplePad の duck-type（PadLoadable）をそのまま再利用**:
  `loadPadFile / playPad / hasPad / padLabel / stopAll / stopPad / clearPad` を
  ClipLauncherRuntime が実装することで、main.ts のパッド配線（D&D 割当・クリック割当・
  パッドオーバーレイ・アセット復元）がコード追加なしで動く。
- **アセット永続化は `params.padAssets`（string[]・hidden）の同名 param を流用**。
  `asset/asset-refs.ts` の `collectAssetRefs` は node type 非依存で `padAssets` を拾うため変更不要。
- **sync 接続有無で即時/クオンタイズ切替**:
  - sync 未接続: パッド押下で即時切替（次フレームの evaluate で実行）。
  - sync 接続（BeatClock の beat/div 想定）: 押下は「アーム（予約）」となり、
    sync の立ち上がりエッジで切替。アーム中のパッドは点滅、アクティブは強調表示。
  - 「接続されているか」は evaluate しか知らないため、`playPad` は pendingIndex を
    立てるだけにし、切替の実行は毎フレームの `step()`（evaluate から呼ぶ）が行う。
    `ctx.input("sync")` が undefined ⇒ 未接続、boolean ⇒ 接続済み、で判定する。
- **trigger 出力は「実際に切替が起きたフレーム」に 1 回発火**（アーム時ではない）。
  Flash 等の演出同期用。
- **音声は扱わない（video は muted 常時）**: muted は自動再生ポリシーと evaluate 内
  `play()`（user gesture 外）の許可に必須。音は SamplePad / AudioFileInput の担当と
  i18n の desc に明記する。
- **loop param**: on/off を全パッドの video 要素へ毎フレーム反映。
- 動画は `loadPadFile` 時に要素を作って preload（paused のまま）。再生するのは
  アクティブな 1 本だけ（切替時: 前を pause → 次を currentTime=0 → play()）。
  同じパッドの再起動は頭から再生し直す（リトリガ・Resolume 等と同じ）。
  画像パッドは切替のみ（再生概念なし）。

## アーム→切替の純関数（nodes/clip-launcher-logic.ts）

```ts
resolveLaunch(pending: number | null, syncConnected: boolean, syncEdge: boolean)
  : { switchTo: number | null; armed: number | null }
```

- pending なし → 何もしない。
- sync 未接続 → 即切替（armed なし）。
- sync 接続・エッジなし → armed のまま保持。
- sync 接続・エッジあり → 切替。

エッジ検出（prevSync 管理）と pending の保持は Runtime 側。

## テクスチャ供給

- 動画: `graph/video-surface.ts` の `VideoTextureSurface` ×1（renderer サイズ RT へ contain 描画）。
  **要修正**: 従来 `render(renderer, video)` は最初に渡された video 要素で
  `THREE.VideoTexture` をキャッシュし続け、別の video 要素へ切り替えると古い映像のままだった。
  `videoTexture.image !== video` のとき dispose して作り直す分岐を追加
  （既存呼び出し元 VideoFile/Camera/Display は常に同一要素を渡すので後方互換）。単体テスト付き。
- 画像: `graph/image-surface.ts` の `ImageTextureSurface` ×1。こちらは既に
  `sourceImage !== image` で texture を作り直す実装済みのため**変更不要**（確認済み）。
- ClipLauncherRuntime は両 surface を 1 つずつ持ち、アクティブパッドの種別で使い分ける。
- previewSource: アクティブパッドのフレームを PREVIEW_W/H canvas に contain 描画
  （`VideoFileInputRuntime.previewFrame` と同じパターン）。

## DOM 依存の注入（テスト容易性）

bun test（happy-dom 個別登録方式）では video/Image の実挙動が信頼できないため、
要素生成・objectURL 管理を `ClipMediaDeps`（createVideo / loadImage / createObjectURL /
revokeObjectURL）として注入可能にする。既定実装 `domClipMediaDeps()` が
`document.createElement("video")`（display:none で body へ追加）と `new Image()` を使う。
muted/playsInline/preload の設定は Runtime 側で行い、fake でも検証できるようにする。

## パッド表示の拡張（アクティブ強調・アーム点滅）

- `NodeEditor.padCellInfo` の戻り値に optional の `active?: boolean; armed?: boolean` を追加
  （SamplePad 側は返さない＝undefined で従来描画）。
- ノード上の padGrid 描画・`editor/pad-overlay.ts` の両方で、active は明るい枠＋塗りの強調、
  armed は `performance.now()` ベース 250ms 周期の枠色点滅。
- main.ts の padCellInfo 配線は PadLoadable duck-type に `padActive?(index)` /
  `padArmed?(index)` を追加して流す。

## padGrid.accept（main.ts のファイルダイアログ）

`graph/node-type.ts` の `padGrid` を `{ rows, cols, accept?: string }` に拡張。
`openPadFileDialog` はハードコードの "audio/*" でなく対象ノード定義の
`padGridAccept(def)`（editor/layout.ts・省略時 "audio/*"＝SamplePad 従来動作）を使う。

## ノード定義

- type: "ClipLauncher", category: "source", padGrid: { rows: 4, cols: 4, accept: "video/*,image/*" }
- inputs: sync (trigger)
- outputs: texture (texture), trigger (trigger・切替フレームに発火)
- params: loop (enum on/off 既定 on), padAssets (string[]・noInput・hidden)
- stopAll()（Stop ボタン）: アクティブ video を pause してアクティブ解除
  （texture null → 出力 undefined＝下流は黒）。アーム/pending も解除。
- stopPad(index): そのパッドがアクティブなら停止・アーム中ならアーム解除。
- clearPad(index): 割当解除（objectURL revoke・要素破棄。アクティブ/アーム中なら解除）。

## i18n / registry

- `i18n-nodes.ts`: node.ClipLauncher.desc / port.sync / port.texture / port.trigger /
  param.loop / param.padAssets（ja/en。網羅テストが自動検証）。
- `nodes/registry.ts`: SamplePad の直後（source 系）に register。
