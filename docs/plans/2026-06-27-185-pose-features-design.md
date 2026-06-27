# #185 身体ドリブン入力ノード（PoseFeatures）設計

Issue: https://github.com/mishi5/three-art/issues/185

## 目的

MediaPipe Pose を「描画素材」だけでなく **演出の制御信号源** に昇格させる。`pose`（`PoseFrame`）を入力に取り、
手の高さ・全身の動き量・ジャンプを number / trigger として出力する `PoseFeatures` ノードを追加し、任意の param を
身体の動きで駆動できるようにする。オーディオリアクティブに次ぐ「第2のリアクティブ軸（身体）」。

## 既存資産と整合

- `CameraInputNode` が `pose` 出力（`PoseFrame` = joints / visibility / center）を持つ。`poseDetect` で遅延起動するため
  本ノードを足しても MediaPipe の二重起動は起きない。本ノードは **pose を受けて number/trigger を出すだけ**。
- `PoseFrame.joints` は `JointAnchors` が `JOINT_INDICES` 順（0..12）で詰めた平滑化済み 3D 座標（**y 反転済み＝上が +**、メートル）。
  index 位置: nose=0 / Lshoulder=1 / Rshoulder=2 / Lelbow=3 / Relbow=4 / Lwrist=5 / Rwrist=6 / Lhip=7 / Rhip=8 / Lknee=9 / Rknee=10 / Lankle=11 / Rankle=12。
- `visibility[i]`（0..1）。既存ロジック同様 `< 0.4` の関節は寄与から除外。
- `center` は可視度重み付き重心（y 上が +）。ジャンプ検出に使う。

### motion について
`JointAnchors.getMotion()` は CameraInput の `motion` 出力（別ポート）で、`PoseFrame` には含まれない。本ノードは `pose` のみを
入力に取るため、**`getMotion()` のアルゴリズム（可視度重み付きの毎フレーム関節変位・指数平滑 0.85/0.15）を本ノード内で
前フレーム関節との差分から再現**する（＝「getMotion() 流用」を pose ストリーム上で実装）。

## 出力ポート（MVP 4 本）

| port | type | 内容 |
|------|------|------|
| `handHeightL` | number | 左手首の高さ（肩中心基準・肩幅正規化 → Remap）。不可視/未接続は 0 |
| `handHeightR` | number | 右手首の高さ（同上） |
| `motion` | number | 全身の動き量（pose 差分から算出・motionScale で 0..1 化 → Remap） |
| `jump` | trigger | 重心 y の上昇速度がしきい値超で 1 フレーム発火（ヒステリシス再武装） |

## 正規化（体格・立ち位置・カメラ距離に非依存）

- 肩中心 `midY = (Lshoulder.y + Rshoulder.y) / 2`、肩幅 `width = |Lshoulder − Rshoulder|`（3D 距離）。
- 手の高さ正規化: `handHeightNorm = (wristY − midY) / (width × raiseSpan)`。
  - 肩の高さで 0、肩幅×`raiseSpan` 上で 1、下げると負。`width` 極小時は 0（破綻回避）。
- 出力 Remap: 正規化値（0..1 想定）を `[outMin, outMax]` に clamp 付きで写す（既存 `remap` 流用）。
- motion: `clamp01(motion / motionScale)` → Remap。

## params

| param | default | 意味 |
|-------|---------|------|
| `smoothing` | 0.3 | 連続出力（handHeightL/R・motion の正規化値）への EMA 係数。1 で即追従 |
| `raiseSpan` | 1.2 | handHeight=1 に対応する「肩幅の倍数」。小さいほど敏感 |
| `motionScale` | 0.3 | motion を 0..1 に正規化する除数（生 motion の想定最大） |
| `jumpThreshold` | 1.2 | ジャンプ発火する重心上昇速度（m/s） |
| `outMin` | 0 | 出力 Remap 下限 |
| `outMax` | 1 | 出力 Remap 上限 |

## 不可視・未接続時の扱い

- pose 未接続（`input("pose")` が undefined）→ 全出力 0・jump 非発火。
- 肩 or 対象手首が `visibility < 0.4` → その手の高さは **literal 0**（Remap を通さず spurious 信号を出さない）。
- pose が一旦切れたら velocity の prev をリセット（復帰時に誤発火しない）。

## 純粋ロジック分離（テスト対象）

`pose-features-logic.ts`:
- `shoulderMetrics(joints)` → `{ midY, width }`
- `handHeightNorm(wristY, midY, width, raiseSpan)`
- `motionStep(joints, prevJoints, vis, prevMotion, smooth)`（getMotion 流用）
- `jumpStep(velY, threshold, armed)`（ヒステリシス再武装）
- `clamp01` / `POSE_POS` 位置定数

`remap` は既存 `process-logic.ts` を流用。

## ノード（`PoseFeaturesNode.ts`）

- category: `input`（CameraInput と同カテゴリ）。inputs: `pose`。outputs: 上記 4 本。
- フレーム間状態 `PoseFeaturesRuntime`（前フレーム関節・前重心 y・前時刻・EMA 値・jump armed）を `createState`。
- registry に登録（input セクション）。

## テスト方針

- 純粋ロジック: 肩幅正規化が体格非依存・raiseSpan/不可視 0・jump のヒステリシス・motion 平滑をユニットテスト。
- ノード統合: `evaluate()` 経由で pose 注入 → 出力検証（math-nodes.test.ts 流儀）。未接続 0・Remap 反映・2 フレームでの jump/motion。
- 実カメラでの pose 反応は headless 不可＝手動確認に委ねる。
