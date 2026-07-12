# #282 複数出力・コーナーピンワープ 設計

対象 Issue: https://github.com/mishi5/three-art/issues/282 （親: #274）

## 概要

Screen ノード拡張方式の複数出力を実装する。各 Screen ノードに「⧉ 出力」トグルを追加し、
ON でその Screen 専用のオフスクリーン canvas ＋専用の別ウィンドウが開く（Screen 2 個＝出力 2 系統）。
各出力にはコーナーピンワープ（射影変換）を掛けられ、出力ウィンドウ内のドラッグ UI で
投影面へ合わせ込める。

- メイン canvas への従来合成（`pickScreenTextures`）は**無変更**。
- ツールバーの既存の外部出力（#148・メイン canvas ミラー）は**無変更**。
- **エッジブレンドは対象外**（別 Issue）。ワープと独立に設計できる（重なり部分の減光は
  ワープ後のフレームに掛けるポストパスであり、本実装のパイプラインに後付け可能なため、
  今回のスコープから外して出力系統の確立を優先した）。

## ワープの数理（`warp-logic.ts`・純関数）

### 座標系

「出力表示空間」（x 右・y 下・(0,0)=出力フレーム左上・(1,1)=右下）で統一する。
Screen の 4 隅 param（`tlX,tlY,trX,trY,blX,blY,brX,brY`）は
「ソースの単位正方形の各隅が出力表示空間のどこへ写るか」を表す正規化座標。
既定は tl=(0,0), tr=(1,0), bl=(0,1), br=(1,1)（＝恒等・ワープなし）。
テクスチャの v 反転（GL は y 上向き）はシェーダ内で吸収し、数理層は y 下向きで閉じる。

### homography

`homographyFromCorners(corners)` は単位正方形 → 4 隅の 3×3 射影変換行列（row-major）を
Heckbert の square-to-quad 閉形式で求める:

- 4 隅を p0=tl(0,0), p1=tr(1,0), p2=br(1,1), p3=bl(0,1) に対応させる
- `sx = x0-x1+x2-x3, sy = y0-y1+y2-y3` が共に 0 ならアフィン（射影項 g=h=0）
- それ以外は `g,h` を 2×2 の行列式で解く標準閉形式（8 元連立の DLT と等価）

**逆行列**（出力画素 → ソース UV）も余因子行列で同時に求めて返す。フラグメントシェーダは
出力側の座標から `H⁻¹` でソース UV を引き、[0,1] 外は黒にする（前方写像より頑健）。

### 退化フォールバック

非有限値・行列式 ≈ 0（3 点同一直線・面積ゼロ等）は forward/inverse とも**恒等行列に
フォールバック**する（例外を投げない。VJ 中に param が変な値になっても画が出続ける）。
`sanitizeCorners(params)` は 8 個の param から corners を作り、非有限は既定値に落とす。

## Screen ノードの param（8 個・noInput）

`kind:"number"`・min -0.5・max 1.5・step 0.001・**noInput: true**（8 ポートも増えると邪魔）。
hidden にはしない（ノード上の param 行で手入力微調整できる・#282 要件）。
`try` は予約語ではないが紛らわしいため、4 隅×xy は `tlX/tlY/trX/trY/blX/blY/brX/brY` の
camelCase で統一した。YAML への永続化・読込時の default 補完は既存の serialize が
`def.params` を見て行うため追加実装なし。

## 出力パイプライン（`screen-outputs.ts`）

`ScreenOutputs` マネージャが Screen ノード id → { 出力 canvas（2D）, OutputWindow, } を管理する。

### 描画方式（読み戻し回避）

texture は WebGL コンテキストを跨げず、`readRenderTargetPixels` は 60fps では重い。
そこで**メイン renderer の default framebuffer を一時キャンバスとして使う**:

毎フレーム、GraphRuntime の評価後（メイン合成の**前**）に `onRenderScreenOutputs` フックで:

1. 開いている各 Screen について、その texture（`outputs.get(id)?.[SCREEN_TEXTURE_KEY]`）を
   ワープシェーダ（`uInvH` に逆 homography を持つフルスクリーンクアッド・`warp-blit.ts`）で
   メイン canvas（default framebuffer）へ描画
2. 出力用 2D canvas へ `drawImage(renderer.domElement, ...)` で GPU-GPU コピー
3. フック終了後、GraphRuntime が従来のメイン合成を描く → **フレーム末尾は必ず従来の
   メイン合成**になり、画面プレビューの見た目は保たれる

`tick()` 内の呼び出し位置は「evaluate ＋ activeReferenced 合成の後・#174 の出力シーン描画と
メイン合成の前」。CPU への読み戻しは発生しない。

出力ウィンドウ表示中は #148 と同様に描画解像度を OUTPUT_RENDER_W/H（1920×1080）へ引き上げ、
本体が隠れても描画が続くよう `setKeepAliveWhileHidden` を（メイン出力との OR で）維持する。

### ウィンドウ

`OutputWindow`（#148）を「window name とウィンドウ HTML を注入できる汎用ミラー」に拡張して
再利用する（引数省略時は従来どおり＝#148 の挙動不変）。Screen ごとに
`node-vj-screen-<nodeId>` のユニーク name で開く。クリーンアップは既存パターンを踏襲
（親 pagehide で閉じる・500ms polling で手動クローズ検知）。Screen ノード削除・シーン切替で
グラフから id が消えた場合は `renderFrame` が検知して閉じる。

## コーナードラッグ調整 UI（出力ウィンドウ内・`buildScreenOutputHtml`）

- **物理キー 'w'（`e.code === "KeyW"`）**で調整モードをトグル（e.key は IME の既知問題 #167 で使わない）。
- 調整モード中は 4 隅ハンドル（12px の色付き div）＋外周ライン（SVG polygon）を表示。
  調整モード中は クリック全画面を抑止（ハンドル外クリックの誤爆防止）。
- ハンドル位置は video の実表示矩形（object-fit: contain のレターボックス考慮）に対する
  正規化座標。contain 矩形の算出は出力ウィンドウの自己完結 HTML 内へインライン実装する
  （親側 `editor/fit.ts` の `containRect` と同等。ロジック重複は許容し、テストは親側の
  純関数＝`containRect`・`warp-logic.ts` のハンドル座標変換で書く）。
- trackpad の pointerup 取りこぼし対策（#167）として、pointermove 中に `buttons === 0` を
  検知したらドラッグを終了する。

### postMessage プロトコル

- 子 → 親（ドラッグ）: `{ type: "node-vj:warp", screenId, corner: "tl"|"tr"|"bl"|"br", x, y, phase: "start"|"move"|"end" }`
  - 親（main.ts）は message リスナで受け、`e.source` が **ScreenOutputs が管理中の出力
    ウィンドウの Window であること**を確認する（出力ウィンドウは `window.open("")` の
    書き込み文書＝同一オリジン。origin 文字列でなく Window 同一性で検証する）。
  - `phase:"start"` で 1 回だけ `history.record`（ドラッグ 1 回＝undo 1 段）。
  - 値は param の min/max（-0.5..1.5）へクランプし step 相当（0.001）へ丸めて
    該当 Screen ノードの params へ書く。次フレームの homography に即反映されるので、
    投影を見ながら合わせ込める。
- 親 → 子（状態同期）: `{ type: "node-vj:warp-state", screenId, corners: {tlX..brY} }`
  - `renderFrame` が param 変化を検知したときだけ送る（undo・ノード上の手入力でも
    ハンドル位置が追従する）。子はドラッグ中の隅には適用しない（丸め往復のジッタ防止）。
- 既存の postMessage ブリッジ（#177 `node-vj:cmd`）とは type が異なるため衝突しない。

## エディタ UI

- `NodeTypeDef.screenOutput?: boolean` を追加（transport/beatClock と同様の目印。Screen だけが立てる）。
- `editor/layout.ts`: `hasScreenOutputRow` / `screenOutputRowRect`（params 直下 1 行）/
  `screenOutputRowLayout`（「⧉ 出力」トグルボタン＋状態ラベルの 2 分割・beatClockRowLayout と同寸法感）/
  `nodeHeight` に 1 行加算。
- `editor/NodeEditor.ts`: ヒットテスト → `onScreenOutputToggle?.(nodeId)`、描画は
  `screenOutputInfo?.(nodeId)` で開閉状態を引き、開いている間はボタンを明るくする。
- `main.ts`: `ScreenOutputs` を生成して editor コールバック・runtime フック・
  描画解像度切替（applyPreviewSize）・keepAlive・warp message リスナを配線。

## i18n

- param 説明: `node.Screen.param.tlX` 等 8 キー（NODE_CATALOG・ja/en。網羅テストが死にキー/
  キー漏れを検出する）。
- ノード内 UI: `node.screen.outputBtn` / `node.screen.outputOn` / `node.screen.outputOff`（CATALOG）。
- 出力ウィンドウ HTML 内の文言は HTML 生成関数に直書き（別ウィンドウはカタログの外・
  既存 buildOutputHtml と同じ扱い）。

## テスト

1. `warp-logic.test.ts`: 恒等・平行移動・スケール・台形（非アフィン性）・逆行列往復・
   退化フォールバック・sanitizeCorners・ハンドル座標変換
2. `screen-outputs.test.ts`: fake deps（canvas/window/drawWarped 注入・ClipMediaDeps パターン）で
   開閉・描画・ノード削除クリーンアップ・warp-state 送信・ownsWindow
3. `screen-output-html.test.ts` / `warp-message.test.ts`: HTML 生成（KeyW・ハンドル・
   postMessage）と受信メッセージ解析の純関数
4. `layout.test.ts` / Screen ノード def 形状 / i18n 網羅テストの追従
