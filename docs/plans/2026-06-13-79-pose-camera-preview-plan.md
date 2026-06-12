# 実装計画: PoseInput ノードのカメラ映像プレビュー

- 対象 Issue: https://github.com/mishi5/three-art/issues/79
- 親 Epic: https://github.com/mishi5/three-art/issues/56
- 前提: #77（ノード隣接プレビュー小窓）

## 確定方針（#79 ブレインストーミング）

- プレビュー源を一般化: `NodeTypeDef.previewSource?(state, node): CanvasImageSource|null`。
  runtime の `getPreviewSource(nodeId)` は previewSource 優先、なければ #77 の texture
  読み戻し canvas。エディタは単一コールバックで drawImage（video は読み戻し不要）
- 👁 表示条件: texture 出力 or previewSource あり（純粋判定 `nodeHasPreview(def)`）
- PoseInput: param `skeleton`(boolean, 既定 OFF)。previewSource は offscreen canvas に
  video を contain 描画し、ON なら主要骨格エッジ（肩肘手首/腰膝足首/肩腰）を重畳
- 未開始/拒否時は null → エディタは暗い小窓＋「no signal」（texture 未着も統一）

## 実装

1. node-type: `previewSource` 追加
2. editor/fit.ts（純粋）: containRect ＋テスト
3. core 変更なし（PoseInput.getVideo は既存）。PoseInputRuntime に video getter と
   最新 landmarks 保持、preview 合成 canvas
4. PoseInputNode: skeleton param・previewSource 実装
5. runtime: getPreviewSource 追加（previewSource ?? texture canvas）
6. NodeEditor: コールバックを getPreviewSource に、👁 条件を nodeHasPreview に、
   小窓 drawImage を contain 対応＋no signal プレースホルダ
7. main 配線

## テスト

- containRect / nodeHasPreview / PoseInputNode 定義（純粋）
- Playwright: PoseInput 👁 ON で「no signal」プレースホルダ（headless はカメラ不可）。
  実カメラ映像・骨格はユーザ確認
