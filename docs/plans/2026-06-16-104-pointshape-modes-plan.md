# #104 PointCloudVisual パイプライン分割（PointShape に sphere/lattice を追加）

対象 Issue: https://github.com/mishi5/three-art/issues/104

親 Epic: #56 / 前提: #101（PointShape/ParticleRender）, #102（PointTransform）

## スコープ（ユーザー確定）
- `PointShape` に **mode enum（cube / sphere / lattice）** を追加し、手続き的に index/hash/noise/
  audio から計算できる形状を集約する（cube は #101 で実装済み）。
- **bones / image は別 Issue に分割**（pose 入力・画像データテクスチャ・per-particle 色の配管が重いため）。
- **旧 `PointCloudVisualNode` は残置**（bones/image を当面提供）。本変更は新ノードの追加のみで、
  保存グラフ/プリセットを壊さない（移行コード不要）。

これにより「形状生成（PointShape）→ Transform（#102）→ 描画（#101）」のパイプラインで、
旧 17 param の縦長ノードに頼らず手続き形状を組めるようになる。

## PointShape の拡張
- params:
  - `mode`（enum: cube/sphere/lattice, 既定 cube）
  - `count`（int, cube/sphere の粒子数）
  - `radius`（number, 形状の広がり）
  - `latticeResolution`（int, 既定 12, 4..20）— lattice の格子解像度 N（粒子数 = N^3）
  - `noiseAmount`（number, 既定 0.15）/ `noiseScale`（number, 既定 1.0）— lattice の simplex 歪み
- inputs: `audio`（任意）— lattice の歪み量を bass で増幅。
- 実効粒子数: lattice は N^3、それ以外は count。テクスチャ寸法は `fieldTexSize(実効count)`。

## 形状シェーダ（PositionFieldPass のフラグメント）
index を gl_FragCoord から復元し、mode で分岐:
- **cube**: `(hash31(idx)*2-1) * radius`（立方体内散布、#101 と同等）
- **sphere**: `normalize(hash31(idx)*2-1) * radius`（球面）
- **lattice**: idx→(ix,iy,iz) の格子座標を [-radius,radius] に正規化し、simplex noise（snoise,
  time アニメ）で歪ませる。歪み量は `noiseAmount * (1 + bass*k)`。
- snoise は PointCloud のもの（Ashima、public domain, ASCII）を流用。

## 互換性
- 旧 PointCloudVisualNode は変更なし。保存グラフはそのまま動く。新 mode は追加のみ。

## TDD（純粋/データ部分）
- `PointShape` の params に mode/lattice 系が含まれること、mode enum の options。
- 実効粒子数の純関数 `shapeCount(mode, count, latticeResolution)`（lattice→N^3, 他→count, 上限クランプ）。
- state/env 無しで evaluate が no-op。
- 実 GPU 形状は headless スモーク（cube/sphere/lattice を切替えて描画・エラー無し）で確認。

## 後続（別 Issue 化を提案）
- bones モード（pose 入力＋関節割当の GPGPU 化）
- image モード（画像 RGB データテクスチャ＋ParticleRender の per-particle 色対応）
- 旧 PointCloudVisualNode の最終的な廃止判断（bones/image 移植完了後）
