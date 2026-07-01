# #217 GraphVisual（数値時系列の波形描画→texture 出力）設計

Issue: https://github.com/mishi5/three-art/issues/217

## 目的（MVP）

number 入力の時系列を折れ線グラフ（波形）で描画し texture 出力する visual sink ノード。
Sine.out などを value に接続すると、Screen 経由でサイン波が表示される。

## ノード仕様

- type: `GraphVisual` / category: `visual` / `isSink: true`
- inputs: `value`（number・未接続時 0）
- outputs: `texture`
- params:
  - `windowSec`(number, 既定 4, 0.25..30) … 横スケール（時間窓・秒）
  - `yMin`(number, 既定 -1) / `yMax`(number, 既定 1) … 縦スケール
  - `lineWidth`(number, 既定 2, 1..8) … 線の太さ
  - `r`/`g`/`b`(number, 0..1) … 線色
  - `bgAlpha`(number, 既定 1, 0..1) … 背景の不透明度（下レイヤ透過用）
  - `zeroLine`(enum off/on, 既定 on) … 値 0 の中央基準線

## 挙動

- `createState` でリングバッファ（(timeSec,value) ペア）を確保。上限は
  `graphMaxSamples(30, 60) = 1800`（最大 windowSec × 想定 fps）でメモリをキャップ。
- `evaluate` ごとに value を timeSec 付きで push（未接続/非有限は 0）。
- `timeSec-windowSec 〜 timeSec` を画面幅にマッピング。**右端が最新・左へ流れるスクロール**。
- 縦は yMin..yMax を下端..上端にマッピング（範囲外はクランプ）。
- 背景＋中央基準線＋折れ線を描いて texture 出力。

## 描画方式：(A) Canvas2D → THREE.CanvasTexture → RT

折れ線・基準線は Canvas2D で素直に描けるため (A) を採用。
`GraphCanvasSurface`（`graph/graph-canvas-surface.ts`）が Canvas2D に描いた内容を
`THREE.CanvasTexture` としてフルスクリーンクアッドで RT へ転写する。
これは `VideoTextureSurface` と同方式で、CanvasTexture の `flipY=true` をクアッド描画で
吸収し、下流（RT texture・`flipY=false`）と向きを揃える。`commit()` は renderer の
clearColor/clearAlpha を保存・復元し、他ノード描画へ影響させない（bgAlpha 透過対応）。

## 純関数（テスト対象）: `nodes/graph-visual-logic.ts`

- `graphMaxSamples(maxWindowSec, fps)` … リングバッファ上限
- `pushSample(buf, t, v, maxSamples)` … push＋古い方から間引き（非有限は 0）
- `valueToY(v, yMin, yMax, height)` … 縦マッピング（範囲外クランプ・退化時中央）
- `computeGraphPoints(samples, params)` … サンプル列→画面折れ線点列
  （窓外除外・右端最新・Y クランプ・空配列許容）

実描画（Canvas2D 命令）は手動確認。純粋部分をテストで厚くカバー。

## スコープ外（将来）

複数入力の重ね描き / 軸目盛・グリッド・数値ラベル / オートスケール /
オシロ式上書きスイープ / signal 入力。MVP は number 1 入力・固定 yMin/yMax・
右→左スクロール・基準線のみ。

## テスト

- `graph-visual-logic.test.ts`（18 件）: 純関数マッピング・リングバッファ
- `GraphVisualNode.test.ts`（7 件）: ノード定義・param・registry・state/env 無し安全

## 手動確認項目

- Sine.out → value → Screen でサイン波が表示される
- windowSec で横スケールが変わる（波の間隔）
- yMin/yMax で縦スケールが変わる
- 範囲外の値でも上下端クランプで破綻しない
- value 未接続でも安全（基準線のみ表示）
