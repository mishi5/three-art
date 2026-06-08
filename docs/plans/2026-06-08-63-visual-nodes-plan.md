# 実装計画: ビジュアルノード化（PointCloud + 各レンダリングモード）

- 対象 Issue: https://github.com/mishi5/three-art/issues/63
- 親 Epic: https://github.com/mishi5/three-art/issues/56
- 先行 ADR: `docs/plans/2026-06-07-59-graph-core-adr.md`

## 目的

点群描画 PointCloud と各レンダリングモード（bones/cube/sphere/lattice/image）を
単一の visual ノードとして提供する。

## 確定方針（#63 ブレインストーミング）

- **単一 `PointCloudVisual` ノード + mode enum**（bones/cube/sphere/lattice/image）。
- image は **バンドル済みデフォルト画像**で対応（ファイルアップロード UI は別途）。
- param は **curated サブセットを編集公開**、非公開はフル既定値。
- **NodeEnv に renderer/camera を追加**（PointCloud の pixelRatio・projection 用）。
- **GraphRuntime に OrbitControls 追加**＋**プレビュー拡大トグル**（クリックで小⇄大）。
- FragmentField/SkeletonGuide は対象外。lattice の onset 波は空配列（base 波動は動く）。

## 実装

### 1. NodeEnv 拡張（`graph/node-type.ts`）
- `NodeEnv` に `renderer: THREE.WebGLRenderer`, `camera: THREE.PerspectiveCamera` を追加。
- `GraphRuntime.env()` に renderer/camera を含める。既存ノードは scene/audio のみ使用で影響なし。

### 2. GraphRuntime（`graph/runtime.ts`）
- OrbitControls を追加（enableDamping、tick で update）。
- `setSize` で renderer/camera 更新（既存）。

### 3. PointCloudVisualNode（`nodes/PointCloudVisualNode.ts`）
- inputs: `pose`(PoseFrame), `audio`(AudioFeatures)。未接続は空 pose / env.audio。
- params(curated): mode, shape.radius/bassPulse/polyhedron, color.hueBase/hueSpread/saturation,
  pointCloud.bassExpansion/baseSize/volumeSize, twist.strength/axis,
  lattice.resolution/waveAmplitude, image.gridW/gridH。
- `createState(env)`: `new PointCloud(renderer.getPixelRatio())` → scene 追加。
  バンドル済みデフォルト画像を読み込み `sampleImageToGrid` → `setImage`（image モード用）。
- `evaluate`: 毎フレーム `setProjection(renderer.domElement.height, camera.fov)`（resize 追従）→
  curated → フル `PointCloudUpdateParams` を構築 → `pc.update(joints,vis,center,audio,params,t)`。
- フル既定値: pointCloud/shape/color/outlier/lattice/image を makeDefaultSettings 準拠で、
  twist は makeDefaultTwist 準拠（strength>0 で enabled）。

### 4. 純粋関数
- `buildPointCloudParams(curated): PointCloudUpdateParams`（既定にマージ）を分離して単体テスト。

### 5. プレビュー拡大トグル（`main.ts`）
- preview canvas を小 PiP(320×180) ⇄ 大(ビューポート ~85%) で切替。クリックで toggle
  （pointerdown→up の移動量 < 5px をクリック判定、ドラッグは OrbitControls の回転）。
- toggle 時に `runtime.setSize(w,h)`。

### 6. registry に PointCloudVisual 登録。

## テスト（TDD）

1. `buildPointCloudParams` の curated 反映・既定フォールバック・mode 反映
2. PointCloudVisualNode のポート定義
3. THREE/PointCloud 実体はブラウザ確認（Playwright で各 mode 描画・エラー0）

## 検証

- `bun run test` 全件パス・`bunx tsc --noEmit` クリーン・マルチエントリ build 成功
- Playwright: PointCloudVisual を追加し mode を bones/cube/sphere/lattice/image に切替、
  エラーなく描画されることを確認

## リスク

- NodeEnv 拡張は型変更だが既存ノードは scene/audio のみ使用 → 影響なし。
- image アセットは pose-particles のサンプルを import（cross-app だが静的アセット）。
- bones は pose 接続＋カメラ距離調整（OrbitControls）が必要な点を動作確認手順で案内。
