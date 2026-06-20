# #134 エフェクト系ノードに有効/無効トグル（無効時パススルー）

対象 Issue: https://github.com/mishi5/three-art/issues/134
関連: Epic #56

## 目的

effect ノードに「有効/無効」トグルを付け、無効時は入力 texture をそのまま出力（パススルー）。
配線を変えずに効果の ON/OFF 比較ができる。

## 設計（共通ヘルパで横断対応）

effect は全て `in`(texture) → `texture`(out) なので、共通化する。

### `nodes/effect-bypass.ts`（純関数・TDD）
- `EFFECT_ENABLED_PARAM`: enum on/off（既定 on）。各 effect の params 先頭に置く。
- `isEffectEnabled(param)`: off でないか。
- `bypassOutput(input, black)`: `{ texture: input("in") ?? black }`（THREE 非依存に unknown 扱い）。

### 各 effect ノード（Blur / Kaleidoscope / Fractal / Flash / TextureTransform）
- params 先頭に `EFFECT_ENABLED_PARAM` を追加。
- evaluate を `const s=ctx.state; if(!s) return {}; if(!isEffectEnabled) return bypassOutput(...); const env...`
  の順に変更（無効時は env 不要＝描画スキップでパススルー）。

## テスト
- `effect-bypass.test.ts`: param 定義 / isEffectEnabled / bypassOutput。
- 既存 effect テストの params 一覧を enabled 追加に更新、enabled トグル存在チェック追加。
- Playwright スモーク: Blur enabled=off で出力 texture が入力(rain)と同一（uuid 一致）、on で別 texture を確認。

## 動作確認
- 各 effect ノードに `enabled` トグル。off で素通り（下流が入力そのまま）、on で効果適用。
