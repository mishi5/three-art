# 実装計画: ポストエフェクトノード（Blur/Kaleidoscope/Fractal）＋EdgeVisual

- 対象 Issue: https://github.com/mishi5/three-art/issues/64
- 親 Epic: https://github.com/mishi5/three-art/issues/56
- 前提: #76（texture チェーン）/ #85（クアッド+RT 方式）。出力（Screen）は #76 で実装済み

## 確定方針（#64 ブレインストーミング）

- texture→texture: Blur(strength・2パスgaussian) / Kaleidoscope(segments,rotation,center,mix) /
  Fractal(iterations,scale,rotation,fade,mix,center)。GLSL は core/effects から移植
- EdgeVisual: pose(+audio)→texture（core EdgeOverlay を VisualSurface で RT 化、
  curated: mode(bones/cube/sphere), anchorCount, kNeighbors, alpha, radius）
- **audio 連動は内蔵しない**（AudioInput→Remap→param 接続で実現）
- category "effect" を追加（terminal 自動表示は visual のみ。effect は 👁/Screen で確認）

## 実装

1. `graph/shader-surface.ts`: クアッド+ortho+専用RT の共通ヘルパ（Blend と同方式）
2. `nodes/BlurNode.ts`: 2 サーフェス h/v、strength<=0 は入力パススルー
3. `nodes/KaleidoscopeNode.ts` / `nodes/FractalNode.ts`
4. `nodes/EdgeVisualNode.ts`: EdgeOverlayUpdateParams を既定値マージで構築
5. registry 登録・エディタ CATEGORY_COLORS に effect 色
6. テスト: 各ノード定義（純粋）・registry。描画は Playwright（Rain→Blur→Screen のぼけ等）
