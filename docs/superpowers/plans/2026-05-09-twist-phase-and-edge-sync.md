# Twist OFF時の phase 漏れと EdgeOverlay 追従の修正

対象 Issue: https://github.com/mishi5/three-art/issues/8

## 現象

1. Twist OFF でも `phaseSpeed > 0` だと描画オブジェクト全体が回り続ける。
2. Twist ON 時、PointCloud は捻れるが EdgeOverlay は捻れず、両者の位置がズレる。

## 原因

- `src/pose-particles/visuals/twist.ts` の `twistPhase()` が `t.enabled` を参照しておらず、OFF 時も `phaseSpeed * timeSec` を返す。
  - `effectiveTwistStrength` は OFF で 0 を返すが、シェーダ側 (`PointCloud.ts`) の `applyTwist` は `if (strength == 0.0 && phase == 0.0) return p;` のショートカットしか持たないため、strength=0 でも phase ぶんの一様回転がかかる。
- `src/pose-particles/visuals/EdgeOverlay.ts` に twist 適用ロジックが存在しない。アンカーの world position を計算した後、PointCloud と同じ twist 変換を施さずにそのままセグメントを書き出している。

## 修正方針

### 1. `twistPhase()` で OFF を尊重する

```ts
export function twistPhase(t: TwistSettings, timeSec: number): number {
  if (!t.enabled) return 0;
  return t.phaseSpeed * timeSec;
}
```

これだけでシェーダの `strength == 0 && phase == 0` ショートカットが効き、Twist OFF 時はパーティクルが静止する。シェーダ側は無修正。

### 2. EdgeOverlay に twist を適用

`EdgeOverlay.update()` で各アンカーの `(x, y, z)` を計算した直後（`anchorPos` に書き込む直前）、`PointCloud` と同一の twist パラメータで TS 版 `applyTwist()` を呼ぶ。

```ts
const twistStrength = effectiveTwistStrength(settings.twist, audio.bass);
const twistPhaseValue = twistPhase(settings.twist, t);
const twistAxis = settings.twist.axis;
// アンカー位置計算後:
if (twistStrength !== 0 || twistPhaseValue !== 0) {
  const [tx, ty, tz] = applyTwist(x, y, z, twistAxis, twistStrength, twistPhaseValue);
  x = tx; y = ty; z = tz;
}
```

PointCloud (GLSL) と TS の `applyTwist` は既に同じ式を実装している（既存テスト済み）ので、両者は一致する。

## テスト戦略 (TDD)

1. **`twist.test.ts` に追加**: `twistPhase` で `enabled=false` のとき 0 を返すケース。今は `phaseSpeed * timeSec` が返るので fail → 修正で pass。
2. **`EdgeOverlay.test.ts` を新規作成**:
   - `EdgeOverlay` を生成し、`sphere` モード・twist OFF と twist ON の組み合わせで `update()` を呼ぶ。
   - 内部 `anchorPos` を読むためのテスト用ヘルパ (`debugReadAnchor(i)`) を `EdgeOverlay` に追加（公開 API は最小限に）。
   - twist OFF と ON で位置が異なることを検証。
   - twist ON 時の値が、TS版 `applyTwist()` の結果と一致することを検証。
3. **既存テスト (86 件) は全て通ったまま** にする。

## 実装スコープ

- 変更ファイル:
  - `src/pose-particles/visuals/twist.ts` (`twistPhase` 修正)
  - `src/pose-particles/visuals/twist.test.ts` (テスト追加)
  - `src/pose-particles/visuals/EdgeOverlay.ts` (twist 適用 + デバッグ getter)
  - `src/pose-particles/visuals/EdgeOverlay.test.ts` (新規)

- 影響しないこと:
  - PointCloud のシェーダ (`twistPhase` の修正だけで OFF時の挙動が直る)
  - FragmentField, BlurPipeline 等
  - 既存の API シグネチャ
