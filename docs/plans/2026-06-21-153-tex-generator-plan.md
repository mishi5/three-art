# #153 tex ジェネレータノードを追加（単色・グラデーション）

対象 Issue: https://github.com/mishi5/three-art/issues/153
親 Epic: #56

## 目的
入力なしで texture を生成するジェネレータノード（単色／線形・放射状グラデーション）を追加する。
plasma/noise 等の後続テクスチャジェネレータの受け皿となる構成。

## 設計
- 新ノード `TexGeneratorNode`（category: `generator`、入力なし、`texture` 出力）。
  - feature-reference では「入力・素材系のジェネレーター」。外部入力でない生成元なので generator に置く（PointShape と同様）。
- フルスクリーンシェーダ → RT は既存 `graph/shader-surface`（`ShaderSurface` / `NDC_VERTEX`）を流用。
- mode（enum: solid/linear/radial）。
  - solid=color1 / linear=方向(angle)に沿った 2 色グラデ / radial=中心→外周の 2 色グラデ。
- 色は **RGB を number param**（r1/g1/b1, r2/g2/b2, 0..1）で表現 → 他ノード（Number/Sine 等）から駆動可能。
  - color param kind が無いため。将来 color param UI ができたら移行可。
- angle（度, 0..360）を linear のグラデ方向に使用。
- `texGenModeInt(mode)` 純関数（solid=0/linear=1/radial=2, 未知=1）。

## テスト
- `tex-generator.test.ts`: 定義（category/入力なし/texture 出力）・mode enum・RGB number param・angle・
  texGenModeInt・registry 登録・headless evaluate no-op。
- GLSL 描画は Playwright スモークでコンパイル＆グラデ描画を確認。

## 成果物
- `nodes/TexGeneratorNode.ts`（新規）・registry 登録・テスト。全733件パス。

## 備考
- 「2色以上」のグラデは v1 では 2 色。多色対応は将来の拡張余地。
- radial の中心は画面中央固定（必要なら center param を後日追加）。
