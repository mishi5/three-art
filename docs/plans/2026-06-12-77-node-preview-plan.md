# 実装計画: Visual ノードのプレビューボタン（隣接小窓 ON/OFF）

- 対象 Issue: https://github.com/mishi5/three-art/issues/77
- 親 Epic: https://github.com/mishi5/three-art/issues/56
- 前提: #76（texture チェーン基盤・常に RT 方式）

## 確定方針（#77 ブレインストーミング）

- **案1: 読み戻し（readback）方式**。プレビュー ON のノードの texture を小さな
  RT（160×90）へ縮小転写 → GPU から読み出し → エディタ 2D キャンバスに drawImage。
  更新は 3 フレームに 1 回に間引く（プレビュー用途に十分、ストール軽減）。
- UI: texture 出力を持つノードのタイトルバー右端に 👁 ボタン。ON でノード右横に
  160×90 の小窓、再クリックで OFF。

## 実装

### 1. データ: `NodeInstance.preview?: boolean`
- エディタ表示状態としてノードに保持（#65 の YAML 保存にも自然に乗る）。
- `serialize.deserializeGraph` で preview を引き継ぐ（ラウンドトリップテスト追加）。

### 2. runtime: プレビュー読み戻しパイプライン
- `previewRT`（160×90、共用 1 枚）と nodeId→offscreen 2D canvas のキャッシュ。
- tick 内（3 フレームに 1 回）: `node.preview` かつ texture 出力があるノードについて
  texture → previewRT へ転写 → `readRenderTargetPixels` → 行反転（WebGL は上下逆）
  → ImageData → offscreen canvas へ putImageData。
- `getPreviewCanvas(nodeId): HTMLCanvasElement | undefined` を公開。

### 3. editor
- `layout.previewButtonRect(node)`: タイトルバー右端の 18×18 領域。
- NodeEditor:
  - texture 出力を持つノードに 👁 ボタンを描画（ON 中は強調色）。
  - onDown: node ヒット時、preview ボタン領域内なら `node.preview` をトグルして終了
    （ドラッグ開始しない）。
  - 描画: preview ON のノードはノード右横（+8px）に 160×90 の小窓
    （getPreviewCanvas の canvas を drawImage、未生成時は暗いプレースホルダ＋枠）。
  - constructor に `getPreviewCanvas` を追加（main で runtime と配線）。

## テスト

- serialize: preview のラウンドトリップ
- layout: previewButtonRect の位置
- 読み戻し・描画は Playwright（👁 クリックで小窓出現/消滅、スクショで内容確認）

## リスク

- readback のストール → 160×90・3 フレーム間引きで実用十分（設計議論済み）
- WebGL 読み出しの上下反転 → 行反転コピーで対処（テストはスクショ目視）
