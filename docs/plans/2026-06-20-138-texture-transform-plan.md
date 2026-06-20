# #138 テクスチャ Transform ノード（2D 移動/拡縮/回転/反転）

対象 Issue: https://github.com/mishi5/three-art/issues/138
関連: Epic #56 / #102（3D 描画オブジェクトの Transform — 本件は 2D テクスチャ対象で別物）

## 目的

texture を入力に取り、2D 変換（平行移動/拡大縮小/回転/反転）を適用して texture を出力する
effect ノードを追加する。

## 設計

### 純ロジック `nodes/texture-transform-logic.ts`（TDD）
- 出力画素 UV → サンプル元 UV の逆変換 `transformUV(u,v,params,aspect)`。
  中心 0.5 まわりで回転（aspect 補正）→ 拡縮 → 反転 → offset 平行移動。
- `wrapCoord(x, mode)`（clamp/repeat/mirror）と合成 `sampleUV`。
- シェーダ（FRAG）はこの式と一致させる（JS/GLSL 二重実装・テストで担保）。

### ノード `nodes/TextureTransformNode.ts`
- `category: "effect"`、texture in → texture out（既存 effect と同様 ShaderSurface 流用）。
- params: offsetX/offsetY / scaleX/scaleY / rotation(rad) / flipX/flipY(enum) / wrap(clamp/repeat/mirror)。
- GLSL 注意（threejs-art）: ASCII のみ / wrap・flip は float uniform で分岐（int 分岐回避）。
- registry に登録（effect グループ）。

## テスト
- `texture-transform-logic.test.ts`: 恒等/offset/scale/flip/回転90°、wrap 3 モード、合成。
- `texture-transform-node.test.ts`: ポート/param 定義・headless no-op・registry 登録。
- Playwright スモーク: RainVisual→TextureTransform→Screen を配線しシェーダがコンパイル・描画され
  texture 出力が得られること、コンソールエラーが無いことを確認。

## 動作確認
- 映像/エフェクト結果を TextureTransform に通し、offset/scale/rotation/flip/wrap で見た目が変わること。
