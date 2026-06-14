# #101 パーティクル描画ノード（GPGPU 位置テクスチャ方式）設計

対象 Issue: https://github.com/mishi5/three-art/issues/101

親 Epic: #56 / 後続: #102（Transform）, #104（PointCloudVisual 分割）

## 背景と方針

現状 `PointCloudVisualNode` は 824 行のモノリシックな `PointCloud`（cube/sphere/polyhedron/
lattice/image/bones のアンカー計算・twist 変換・色・描画をすべて 1 つの頂点シェーダで実施）に
依存している。これを「形状生成 / Transform / 描画」に分割する一環として、描画責務を独立ノードへ
切り出す。

ノード間のデータ受け渡しは **GPU 常駐の位置テクスチャ（GPGPU）方式（方式 E）** を採用。
点群座標を float RenderTarget に焼き、ノード間ではそのテクスチャ参照を流す。CPU 往復が無く
（性能劣化なし）、本物のデータフロー（実座標）で Transform を直列合成でき、将来の汎用描画にも
開かれる。

## データ表現

- **位置テクスチャ**: `RGBA32F` の RenderTarget。1 テクセル = 1 粒子、`RGB = ワールド座標 xyz`、
  `A = 予備`（将来 active フラグ／サイズ係数）。three r170（WebGL2 既定）で float RT 利用可。
- **PointField**（`points` ポートを流れる値）:
  ```ts
  interface PointField { texture: THREE.Texture; count: number; texW: number; texH: number; }
  ```
- **テクスチャ寸法**: `texW = ceil(sqrt(count))`, `texH = ceil(count / texW)`（純関数 `fieldTexSize`）。
  count 変化時に RT を作り直す。

## ポート型

- `port-types.ts` の `PortType` に `"points"` を追加（`PORT_TYPES` 配列、`NodeEditor` の
  `PORT_COLORS` にも 1 色追加）。`isCompatible` は厳密一致のまま（`points→points` のみ）。

## GPGPU 基盤: PositionFieldPass

- `GPUComputationRenderer`（ピンポン用）ではなく、feed-forward チェーン向けの軽量自前ヘルパを新設。
- フルスクリーン三角／quad ＋ フラグメントシェーダで float RT に位置を書く小さなラッパ。
  `render(renderer, uniforms)` で 1 パス実行し、`texture` を返す。`setSize(w,h)` で RT 追従。
- 形状生成・Transform の各段がこれを 1 つ持ち、自分の RT に書く（段間で破壊し合わない）。

## ノード構成（本 Issue の成果物 = スライス 1）

1. **PointShape**（形状生成。本 Issue では cube のみ。#104 で sphere/lattice/image/bones を追加）
   - inputs: なし（#104 で pose/audio を検討）。params: `count`（粒子数）, `radius`。
   - PositionFieldPass で cube アンカーを位置テクスチャに書き、`{ points: PointField }` を出力。
2. **ParticleRender**（描画本体。本 Issue の主役。`isSink: true`）
   - inputs: `points`(points), `audio`(audio)。outputs: `texture`。
   - params: `baseSize` / `volumeSize` / `bassExpansion` / `hueBase` / `hueSpread` / `saturation`。
   - `THREE.Points`（count 頂点・各頂点 `aIndex`）の頂点シェーダで位置テクスチャを texelFetch →
     投影 ＋ `gl_PointSize`（baseSize ＋ audio 駆動）。フラグメントで HSV→RGB の円形粒子。
   - `VisualSurface` の RT に描いて texture 出力（#98 の Screen 接続必須モデルに準拠）。

責務分担: 形状変形（bassPulse 半径脈動・lattice 波）は生成/Transform 段（#104/#102）。
サイズ脈動・色は描画段（本 Issue）。

## データフロー

```
PointShape(cube) --points--> ParticleRender --texture--> Screen
                              ^audio
```

評価はグラフの依存順（既存 DAG）。1 フレーム内で PointShape → ParticleRender の順に走る。
各ノードは createState で RT/パスを確保し、disposeState で解放する。

## テスト方針

- 純粋/データ部分はユニットテスト:
  - `port-types`: `"points"` の存在・`isCompatible`。
  - `fieldTexSize(count)`: 寸法計算（count=1, 完全平方, 非平方, 0）。
  - ノードのポート/param 定義（PointShape は points 出力、ParticleRender は points/audio 入力・
    texture 出力、isSink、param 既定）。
  - state 無し evaluate が安全に no-op を返すこと。
- WebGL を要する GPGPU 描画は headless Playwright スモーク（`PointShape→ParticleRender→Screen`
  で texture が出る・コンソールエラー無し）で検証。

## 後続への布石

- #102 PointTransform: `points→points`。PositionFieldPass で translate/rotate/twist を適用。
- #104: PointShape に全モード（sphere/lattice/image/bones）を実装し、旧 PointCloudVisualNode を
  本パイプラインへ移行（旧ノード残置 or 読込時変換は #104 設計時に判断）。
