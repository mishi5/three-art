# エフェクトノード5種の追加（#188〜#192）

VJ 表現を広げる effect 系ノード（texture→texture）を5種追加する。バンドルブランチ
`bundle/effect-nodes` でまとめて実装。

## 対象 Issue

- Bloom/Glow: https://github.com/mishi5/three-art/issues/188
- RGB Shift/色収差: https://github.com/mishi5/three-art/issues/189
- Pixelate/モザイク: https://github.com/mishi5/three-art/issues/190
- Color/HSV 調整: https://github.com/mishi5/three-art/issues/191
- CRT/VHS 質感: https://github.com/mishi5/three-art/issues/192

## 共通方針

- 既存 effect ノード（`DistortNode` / `FlashNode` / `BlurNode`）のパターンを踏襲。
  - `NodeTypeDef`（category=effect, isSink, in/out=texture）＋ `EFFECT_ENABLED_PARAM`。
  - `ShaderSurface`（`graph/shader-surface.ts`）に全画面クアッドを描画。
  - 無効時は `bypassOutput` でパススルー（#134）。
- GLSL はインライン TS テンプレートリテラル＋ **ASCII のみ**（コメント含む）。
  WebGL1 GLSL ES 1.00 で非 ASCII がコンパイルを黙って失敗させる罠を回避。
- TDD: 各ノードでテスト先行（ポート型・params・registry 登録・no-op、純ロジックは個別関数化）。
  GPU レンダリング結果は検証せず、実描画はユーザ動作確認に委ねる（既存方針）。

## 各ノードの設計

### Bloom（#188）
- マルチパス: 明部抽出（threshold soft-knee）→ 分離ガウスぼかし（h/v, Blur 流用）→ 加算合成。
- params: `enabled` / `threshold` / `intensity` / `radius`。intensity<=0 はパススルー。

### RgbShift（#189）
- R/B を逆方向にオフセット。`kick` trigger の立ち上がりで瞬間的にずれ量を増幅し減衰。
- 純クラス `RgbShiftRuntime`（`FlashRuntime` と同形、`envelopeValue` を流用）でエッジ検出＋減衰をテスト。
- params: `enabled` / `amount` / `angle` / `kickAmount` / `decay`。

### Pixelate（#190）
- UV をブロックグリッドにスナップ。任意で posterize（色階調量子化）。
- 純関数 `pixelateBlocks(w,h,blockSize)` でブロック数算出（0 除算・0 ブロック防止）をテスト。
- params: `enabled` / `blockSize` / `posterize`。

### ColorGrade（#191）
- rgb↔hsv 変換で色相回転・彩度・明度・コントラスト。
- params: `enabled` / `hueShift` / `saturation` / `brightness` / `contrast`（sat/bright/contrast 既定 1＝恒等）。

### Crt（#192）
- 走査線・色にじみ（R/B 横ずれ）・時間シードのノイズ（`Math.random` 不使用）・ビネット。
- params: `enabled` / `scanline` / `colorBleed` / `noise` / `vignette`。

## テスト結果

- 新規テスト: bloom 4 / rgb-shift 5 / pixelate 6 / color-grade 4 / crt 3。
- 全体: 850 pass / 0 fail。`bunx tsc --noEmit` クリーン。
