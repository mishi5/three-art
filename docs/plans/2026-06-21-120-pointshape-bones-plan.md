# #120 PointShape に bones モードを追加（pose 駆動の GPGPU 形状）

対象 Issue: https://github.com/mishi5/three-art/issues/120
親 Epic: #56 / 前提: #101（PointShape/ParticleRender, GPGPU 位置テクスチャ）, #104（cube/sphere/lattice）

## 目的
PointShape に bones モードを追加し、pose（13 関節）に追従する点群を GPGPU で生成する。
旧 PointCloudVisualNode の bones 機能を新パイプライン（feedforward GPGPU 位置テクスチャ）へ移行する。

## 設計方針（現行アーキテクチャに素直に乗せる）

### 変更点
1. **mode 追加**: `ShapeMode` に `"bones"` を追加。`MODE_INT.bones = 3`。enum options 末尾に `"bones"`。
2. **pose 入力ポート**: PointShape に `{ id: "pose", type: "pose" }`（任意）を追加。
3. **uniform 追加**: `uJoints[13]`（vec3 配列）/ `uVisibility[13]`（float 配列）/ `uCenter`（vec3）。
   evaluate で pose（`PoseFrame`）から毎フレーム詰める。pose 未接続なら全関節 visibility=0。
4. **FRAG の bones 分岐**（`uMode > 2.5`）:
   - 粒子 index → 所属関節を round-robin（`mod(idx, 13)`）で決定（count に依らず均等分配）。
   - `hash31(idx)` 由来のオフセットで関節位置周りにクラスタ散布（広がり = `uRadius`）。
   - `uBass` 連動の expansion と shimmer（新 param 無し・audio 駆動）。
   - 位置 = `selectJoint(jointIdx) - uCenter + offset`。
   - **動的 uniform 配列インデックス回避**: 旧 PointCloud と同じく `selectJoint`/`selectVisibility`
     の if チェーンで参照（threejs-art の既知の罠対策）。
5. **可視度ゲート**: 位置テクスチャ `.a` に visibility 由来のマスク（0..1）を書く。
   bones 以外のモードは従来どおり `a = 1.0`。
6. **ParticleRender の `.a` 対応**: VERT で `texture2D(uPosTex, puv)` の `.a` を読み、粒子径に乗算。
   `a≈0` で quad が潰れて不可視になる。既存モード（a=1.0）は挙動不変。

### 据え置き（重要）
- **param は追加しない**（`["mode","count","radius","noiseAmount","noiseScale"]` のまま）。
  bones では `radius` を関節クラスタの広がりに流用、shimmer/outlier は audio 駆動。
  → 「全 mode 共通 param のみ」原則（point-shape-modes.test.ts）を維持。
- **PointField 型は不変**（位置テクスチャ 1 枚のみ）。色は ParticleRender の HSV(seed) のまま。

## テスト方針
- ユニット（bun test, GPU 無し）で検証できる範囲:
  - mode enum に `bones` を含む / `MODE_INT` に bones / options 順序。
  - PointShape が `pose` 入力ポートを持つ。
  - `shapeCount("bones", n)` の挙動（cube 同様 count をそのまま、クランプ）。
  - pose→uniform 詰めの純粋ヘルパ（`packPoseUniforms`）の単体テスト。
- シェーダ描画自体は Playwright スモークで「コンパイル＆描画されること」を確認
  （カメラ実起動を伴う pose 追従は自動化せずユーザ手動確認）。

## 成果物
- `PointShapeNode.ts`: bones モード（uniform / FRAG / evaluate）。
- `ParticleRenderNode.ts`: 位置テクスチャ `.a` を粒子径マスクとして使用。
- テスト追加（point-shape-modes.test.ts ほか）。
- 動作確認（カメラ pose で点群が人体に追従）。

## 備考
旧 PointCloudVisualNode の廃止判断は bones/image 両方の移行完了後に別途。
