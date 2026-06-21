# #148 出力を別ウィンドウ/フルスクリーンに表示する

対象 Issue: https://github.com/mishi5/three-art/issues/148
親 Epic: #56

## 目的
エディタとは別の物理ディスプレイ（プロジェクタ/セカンドディスプレイ）へ映像出力する。

## 設計（ユーザ確認済み）
- 転送方式は **B: `previewCanvas.captureStream()` → 出力ウィンドウの `<video>`**。
  WebGL canvas でも安定（preserveDrawingBuffer 不要）・renderer 設定を触らない。
- Multi-Screen Window Placement API（自動配置）は**今回は見送り**（手動でウィンドウ移動＋全画面）。

## 実装
- `src/apps/node-vj/output-window.ts`（新規）:
  - `buildOutputHtml()`: 黒背景・余白なしで `<video id=out autoplay muted playsinline object-fit:contain>` を
    全画面表示し、クリックで Fullscreen API に入る HTML（純粋関数・テスト対象）。
  - `OUTPUT_CAPTURE_FPS = 60`。
  - `class OutputWindow`: `open(sourceCanvas)` で `window.open()` → HTML 書込 →
    `sourceCanvas.captureStream(fps)` を video.srcObject に設定。`close()` / 本体 pagehide で
    クリーンアップ。出力ウィンドウが閉じられたら polling で検知し onClose で UI 同期。
- `main.ts`: 下部バーに「🖥 出力ウィンドウ」トグルボタンを追加（previewCanvas=renderer 出力 canvas をソースに）。

## テスト
- `output-window.test.ts`: buildOutputHtml の構造（video/object-fit:contain/黒背景/余白0/autoplay/
  muted/playsinline/requestFullscreen/id=out）・FPS 妥当性。全762件パス。
- 別ウィンドウ/captureStream/フルスクリーンは DOM 依存のため Playwright スモークで
  popup に video（srcObject=MediaStream 1 track, object-fit:contain）が出て本体映像がミラーされることを確認。

## 成果物
- `output-window.ts`（新規）・`main.ts`（ボタン）・テスト。

## 追記: 全画面で描画が止まる不具合の修正
- 症状: 出力ウィンドウを全画面にすると 1〜2 秒後に描画が固まる。
- 原因: 描画ループは本体ウィンドウの `requestAnimationFrame` 駆動。全画面の出力ウィンドウが
  本体を覆う → 本体が hidden になり rAF が背面スロットルされ、ソース canvas が更新されず
  captureStream も固まる。
- 修正: `graph/background-ticker.ts`（新規）の Worker タイマー（背面でもスロットルされない）で
  tick を駆動するフォールバックを追加。`GraphRuntime.setKeepAliveWhileHidden(on)` を設け、
  出力ウィンドウ表示中だけ有効化。`visibilitychange` で hidden になったら Worker 駆動、
  可視に戻れば rAF に戻す（二重評価しないようガード）。`main.ts` の出力トグルから連動。
- テスト: `background-ticker.test.ts`（Worker ソース）。hidden 化は headless で再現できないため
  実全画面での描画継続は手動確認に委ねる。

## 追記2: 出力品質（解像度）の修正
- 症状: 出力ウィンドウの線が太く滲む（低解像度）。原因は出力が小さい PiP canvas
  （既定 320×180）をミラーしていたため、拡大表示でボケていた。
- 修正: 表示 CSS サイズと描画解像度を分離。`GraphRuntime.setRenderSize(w,h,pixelRatio)`
  （updateStyle=false で canvas style を触らず drawing buffer のみ設定）を追加し、
  出力ウィンドウ表示中は **1920×1080 で描画**（PiP は CSS で縮小表示＝同じ映像の縮小ビュー）。
  captureStream が 1080p になり出力が鮮明に。
- 優先度（ユーザ指定）: 出力ウィンドウ ＞ ノード小窓 ＞ 右下 PiP。
  小窓 readback スキップは hidden 時のみに戻し（可視時は維持）、PiP は出力の縮小ビューと割り切る。

## 既知の制約（フレームレート・シングルモニタ）
- 出力ウィンドウがフォーカスを持つ（=本体が背面/hidden）と、ブラウザの hidden ページ
  描画スロットルで本体の描画レートが落ち、出力も同レートになる。Worker 駆動でフリーズは
  防げるがレート上限は超えられない。**滑らかな出力には本体を可視に保つ運用（デュアルモニタで
  エディタを主モニタに残す）が前提**。シングルモニタでの全画面提示は #136 のタブ内全画面が適。
- 根本対応（OffscreenCanvas + Worker レンダリングで可視性 throttle 回避）は大規模なため別 Issue 候補。

## スコープ外
- OBS 配信/録画・NDI/Spout 等（別途）。Multi-Screen 自動配置（別 Issue 可）。
