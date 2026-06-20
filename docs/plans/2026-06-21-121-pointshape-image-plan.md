# #121 PointShape に image モードを追加（画像サンプリング GPGPU 形状＋粒子色）

対象 Issue: https://github.com/mishi5/three-art/issues/121
親 Epic: #56 / 前提: #101, #104, #120（bones）

## 目的
PointShape に image モードを追加し、画像をグリッド状にサンプリングした「色付き点群」を GPGPU で生成する。
旧 PointCloudVisualNode の image 機能を新パイプラインへ移行する（bones に続く移行第2弾）。

## 決定済み方針（ユーザ確認済み）
- 画像ソースは **静止画専用の入力ノードを新設**（ImageFileInput）。VideoFileInput/Camera の texture 流用ではなく専用ノード。

## 設計

### 1. 新ノード: ImageFileInput（category: input）
- `fileInput: { accept: "image/*" }`、出力 `texture`。
- 画像ファイル → `HTMLImageElement`（または ImageBitmap）→ `THREE.Texture`（sRGB, flipY 調整）。
- VideoFileInput と同じ fileInput UI / loadFile / previewSource の枠組みを踏襲（音声は無し）。
- 出力は素の画像テクスチャ（アスペクト比は PointShape 側で平面サイズに反映）。

### 2. PointShape image モード
- `ShapeMode` に `image` 追加（`MODE_INT.image = 4`）。
- 入力に `texture`（画像ソース・任意）を追加。未接続なら何も出さない（count=0 相当 or alpha=0）。
- **位置パス（既存 FRAG に image 分岐）**:
  - 粒子 index → グリッド (gridW×gridH) の (ix,iy)。gridRes = round(sqrt(count))、gridW=gridH=gridRes。
  - 平面配置: `(u-0.5)*planeW, (0.5-v)*planeH, 0`。planeH = radius*2、planeW = planeH*imageAspect。
  - Z 押し出し: 画像テクスチャを uv でサンプルした輝度 × audio(mid+treble) ×係数（**audio 駆動・新 param 無し**）。
  - 既存の simplex warp（noiseAmount/noiseScale）はそのまま上乗せ。
- **色パス（新規 PositionFieldPass）**: 同じ画像テクスチャを grid uv でサンプルし RGB を color テクスチャへ書く。
  - image モード時のみ render。他モードでは color テクスチャ未使用。

### 3. 粒子色の受け渡し ← 本 PR の設計上の要点（ユーザ確認）
- **PointField を拡張**: `colorTexture?: THREE.Texture`（任意・後方互換）。
- ParticleRender: `field.colorTexture` があれば per-particle 色として採用（無ければ従来の HSV(seed)）。
- PointTransform: colorTexture をそのまま透過（位置のみ変換）。

### 4. param 据え置き（重要・bones と同思想）
- params は現状の `["mode","count","radius","noiseAmount","noiseScale"]` のまま。
  - count → グリッド解像度、radius → 画像平面サイズ、noise 系 → warp、audio → Z 押し出し・色ブースト。
- → 「全 mode 共通 param のみ」原則（point-shape-modes.test.ts）を維持。

## テスト方針
- ユニット（GPU 無し）: image を mode enum/MODE_INT に追加 / PointShape の texture 入力ポート /
  shapeCount("image") / グリッド解像度導出の純関数 / ImageFileInputNode の定義（fileInput accept, outputs）/
  PointField 型に colorTexture（型レベル）。
- 既存 ImageSampler は CPU サンプルの実装（今回は GPU サンプル方式のため未使用だが温存）。
- 描画は Playwright スモークでシェーダのコンパイル＆色付き描画を確認。
  画像ファイル読込（fileInput）は手動確認（自動でファイルダイアログは扱わない）。

## 成果物
- `ImageFileInputNode.ts`（新規）+ registry/menu 登録。
- `PointShapeNode.ts`: image モード（位置 image 分岐＋色パス）。
- `ParticleRenderNode.ts`: colorTexture per-particle 色対応。
- `point-field.ts`: colorTexture 追加。`PointTransformNode.ts`: 透過。
- テスト追加・動作確認。

## 備考
旧 PointCloudVisualNode の廃止判断は本 PR（image）完了後に別途検討（bones/image 両移行が揃う）。
