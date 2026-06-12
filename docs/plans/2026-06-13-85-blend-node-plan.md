# 実装計画: Blend（テクスチャ合成）ノード

- 対象 Issue: https://github.com/mishi5/three-art/issues/85
- 親 Epic: https://github.com/mishi5/three-art/issues/56
- 前提: #76（texture チェーン基盤）

## 確定方針（#85 ブレインストーミング）

- 入力 `a`/`b`(texture)、param `mode`(enum: normal/add/multiply/screen)・`mix`(0..1、
  #74 により入力ポート化)、出力 `texture`。category は visual（終端で自動表示・👁 対象）
- mix は全モード共通で `出力 = lerp(a, 合成結果, mix)`
- 全画面クアッド＋ShaderMaterial を自前 RT へ描画（専用 Orthographic カメラ・サイズ追従）
- 未接続 texture は 1×1 黒。GLSL は ASCII・mode 分岐は float uniform の if 連鎖

## 実装

1. `nodes/blend-logic.ts`（純粋）: `blendModeToFloat(mode)` ＋テスト
2. `nodes/BlendNode.ts`: BlendSurface（ortho+quad+RT）state、evaluate で uniforms 更新→RT 描画
3. registry 登録（visual）
4. テスト: モード変換・ポート/param 定義・state なし no-op・registry
5. Playwright: Rain→a / PointCloud→b / Blend→Screen、mode/mix 切替スクショ
