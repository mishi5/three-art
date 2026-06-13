# #107 onset 検出が機能していない疑いの修正

対象 Issue: https://github.com/mishi5/three-art/issues/107

親 Epic: #56 / 関連: #100（AudioInput 分割で発見）

## 原因の再特定

当初 Issue では `OnsetDetector.getWaveTimes()` の固定長を疑ったが、調査の結果:

- `OnsetDetector.getWaveTimes()` が長さ 4 のリングバッファを返すのは **pose-particles の
  意図的な設計**（`App.ts:550` で `pointCloud.setWaveTimes()` に波紋エフェクト用の onset
  タイムスタンプ配列を渡す）。ここは変更してはならない。
- 実際のバグは **node-vj 側 `audio-feature-logic.ts` の `OnsetTracker`** が
  `getWaveTimes().length`（常に 4）を「新規発火数」とみなしている点。
  - 初回フレーム: `4 > 0` → true（音と無関係に発火）
  - 以降: `4 > 4` → 常に false

## 修正方針

`OnsetDetector` の既存挙動は変えず（pose-particles・既存テスト保護）、以下を行う:

1. `OnsetDetector` に `getLastOnsetTime(): number` ゲッターを追加（純粋な追加。
   内部 `lastOnsetTime` を公開。初期値 `-Infinity`）。
2. `OnsetTracker.detect` を「直近 onset 時刻が前フレームより進んだか」で判定するよう修正:
   - 新規 onset 発火時のみ `lastOnsetTime` が増加 → そのフレームだけ true。
   - 無音・定常時は不変 → false。初回フレームも `-Infinity > -Infinity` = false で誤発火しない。

## TDD

1. `OnsetDetector.test.ts`: `getLastOnsetTime` の初期値 `-Infinity`、発火後にその時刻を返す、
   cooldown 中は更新されないことを確認。
2. `audio-feature-logic.test.ts`: `OnsetTracker` を正しい挙動に書き換え:
   - 無音（delta 小）では false（初回フレーム含む）
   - bass がしきい値超で立ち上がったフレームのみ true
   - 定常フレームは false
   - cooldown 経過後の再立ち上がりで再び true
3. 実装 → 全テストパス → `bunx tsc --noEmit`。

## 影響範囲

- `src/core/audio/OnsetDetector.ts`（ゲッター追加のみ）
- `src/apps/node-vj/nodes/audio-feature-logic.ts`（`OnsetTracker`）
- pose-particles は不変（`getWaveTimes()` の挙動を変えないため）
