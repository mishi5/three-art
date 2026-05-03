# Twist エフェクトの実装

対象 Issue: https://github.com/mishi5/three-art/issues/2

## 目的

pose-particles の点群（PointCloud + FragmentField）に「ツイスト（ねじれ）」変形を加える。指定軸まわりに、軸方向の座標値に比例した角度で各点を回転させる古典的なアフィン変形。GUI から live でパラメータ調整できるようにする。

## 仕様

### パラメータ（`Settings.twist`）

| キー | 型 | 既定値 | 範囲 | 意味 |
|---|---|---|---|---|
| `enabled` | bool | `false` | — | エフェクトのオン／オフ |
| `axis` | `"x" \| "y" \| "z"` | `"y"` | — | ねじれの回転軸 |
| `strength` | number | `1.0` | 0..10 | 単位距離あたりの回転量 (rad/m) |
| `bassDrive` | number | `0.0` | 0..3 | 低音 (`audio.bass`) で `strength` をブーストする量 |
| `phaseSpeed` | number | `0.0` | -3..3 | 時間で位相が回る速度 (rad/s)。0=静止 |

### 数式

`uCenter` を中心として、軸方向座標値 `s` に比例する回転角を平面に適用する:

```
let p = pos - uCenter
let s = pick(p, axis)              // axis に応じて p.x / p.y / p.z
let angle = effectiveStrength * s + phase
let (a, b) = pickPlane(p, axis)    // y軸なら(x,z)、x軸なら(y,z)、z軸なら(x,y)
rotate (a,b) by angle in 2D
let twisted = recompose(p, axis, a, b)
final = twisted + uCenter
```

ここで:
- `effectiveStrength = strength * (1 + bass * bassDrive)`
- `phase = phaseSpeed * uTime`

### 適用先

- `PointCloud`（bones/cube/sphere 全モード）
- `FragmentField`（bones モード時のみ表示されるが、ツイストは描画パスで実施）

両者で同じ `Settings.twist` を共有し、同じ shader ロジックで実装する。

### Motion ルーティング

`MOTION_TARGETS` に `"twist.strength"` を追加。ボディの動きで `strength` を倍率ブースト可能。

### GUI

`SettingsPanel` に `Twist (ねじれ)` フォルダを追加:
- enabled (checkbox)
- axis (dropdown: x/y/z)
- strength (slider 0..10)
- bassDrive (slider 0..3)
- phaseSpeed (slider -3..3)

## アーキテクチャ

### ファイル

- 新規 `src/pose-particles/visuals/twist.ts` — ツイスト数学のテスト可能ユーティリティ
  - `axisToInt(axis): 0 | 1 | 2`
  - `effectiveTwistStrength(twist, bass): number`
  - `twistPhase(twist, timeSec): number`
  - `applyTwist(x, y, z, axis, strength, phase): [number, number, number]`
- 編集 `src/pose-particles/settings.ts`
  - `Settings.twist` を追加、defaults、deep-merge は既存実装で版互換になる
  - `MOTION_TARGETS` に `"twist.strength"` を追加
- 編集 `src/pose-particles/visuals/PointCloud.ts`
  - 新 uniform: `uTwistEnabled`, `uTwistAxis`, `uTwistStrength`, `uTwistPhase`
  - シェーダ内の `pos` 計算後にツイストを適用
- 編集 `src/pose-particles/visuals/FragmentField.ts`
  - PointCloud と同じ uniform / シェーダ実装
- 編集 `src/pose-particles/ui/SettingsPanel.ts`
  - Twist フォルダを追加
- 編集 `src/pose-particles/App.ts`
  - `applyMotionTo` の `case "twist.strength"` を追加

### シェーダ側 GLSL

WebGL1 互換性のため:
- `uTwistAxis` は `uniform float`（0=x, 1=y, 2=z）として渡し、`< 0.5 / < 1.5 / else` で分岐
- 文字列はASCIIのみ
- 動的配列インデックスは使わない

## テスト方針

`src/pose-particles/visuals/twist.test.ts` に以下のテストを書く:

1. `axisToInt`: "x"=0, "y"=1, "z"=2
2. `effectiveTwistStrength`: `enabled=false` → 0、`enabled=true` → `strength * (1 + bass * bassDrive)`
3. `twistPhase`: `phaseSpeed * timeSec`
4. `applyTwist` (axis="y"):
   - `y=0` で回転角 0、入力 `(1, 0, 0)` がそのまま
   - `y=1, strength=PI/2, phase=0` で `(1, 1, 0)` → `(0, 1, 1)` 近傍（90度回転）
   - 円柱距離 `sqrt(x^2 + z^2)` がツイスト前後で保たれる
5. `applyTwist` (axis="x"): yz平面が回転、x が保たれる
6. `applyTwist` (axis="z"): xy平面が回転、z が保たれる

`App.applyMotionTo` の `twist.strength` ケースは既存テスト枠がないので、`twist.test.ts` に小さな wrapper テストを書くか、`applyMotionTo` を export してテスト。シンプルさを優先して export しテストする。

## 実装手順

1. `twist.test.ts` を書く（赤）
2. `twist.ts` を実装（緑）
3. `settings.ts` に `Settings.twist` と MOTION_TARGETS 追加
4. `App.ts` の `applyMotionTo` / `cloneSettings` を更新
5. `PointCloud.ts` のシェーダと uniforms を更新
6. `FragmentField.ts` のシェーダと uniforms を更新
7. `SettingsPanel.ts` に Twist フォルダ追加
8. 全テスト実行（緑）
9. ブラウザで動作確認（dev サーバ）
