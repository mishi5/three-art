# #102 中心移動・方向調整（Transform）ノード

対象 Issue: https://github.com/mishi5/three-art/issues/102

親 Epic: #56 / 前提: #101（points 型・PositionFieldPass）/ 後続: #104（PointCloudVisual 分割）

## 目的
点群（`points`）の平行移動・回転を行う Transform ノードを新設し、描画ノードの前段に挟んで
Visual をシーン内で配置・向き付けできるようにする。

## 方針（#101 の土台を活用）
- **`PointTransform`** ノード: 入力 `points` → 出力 `points`。
- `PositionFieldPass` で入力位置テクスチャを読み、各粒子座標に変換 `p' = M · p` を適用して
  同サイズの位置テクスチャに書き出す。
- 変換行列 M は **CPU で合成した mat4**（`THREE.Matrix4.compose(translate, quaternion(euler), 1)`）。
  適用順は **回転（原点まわり）→ 平行移動**（TRS 標準: M·p = T·R·p）。
- params: `translateX/Y/Z`（m, 既定 0, 範囲 -3..3）、`rotateX/Y/Z`（度, 既定 0, 範囲 -180..180）。

## データフロー
```
PointShape --points--> PointTransform --points--> ParticleRender --texture--> Screen
```
評価はグラフ依存順。PointTransform は自分の RT に書き、ParticleRender がそれを読む。

## 変更点
- `src/apps/node-vj/nodes/PointTransformNode.ts`（新規）: フラグメントで `uSrc` を `vUv` サンプル →
  `uMat` 適用。createState で PositionFieldPass、evaluate で入力サイズに RT 追従・行列更新・出力。
- `composeTransformElements(tx,ty,tz,rxDeg,ryDeg,rzDeg): number[16]`（純関数）を同ファイルに export。
- `registry.ts`: process 群に登録。

## TDD
- `composeTransformElements`: 全 0 で単位行列／平行移動のみで位置列が (tx,ty,tz)／90°回転の正当性。
- ノード定義: type=PointTransform, category=process, inputs `points`, outputs `points`,
  params translate*/rotate*。
- state/env 無し or 入力 `points` 無しで evaluate が `{}`（no-op）。
- 実 GPU 変換は headless スモーク（PointShape→PointTransform→ParticleRender→Screen で
  translate/rotate が効く・エラー無し）で確認。
