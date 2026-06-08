# 実装計画: 処理（変調）ノード toolkit

- 対象 Issue: https://github.com/mishi5/three-art/issues/62
- 親 Epic: https://github.com/mishi5/three-art/issues/56
- 先行 ADR: `docs/plans/2026-06-07-59-graph-core-adr.md`

## 目的

変調・処理ロジックを number 中心の処理ノードとして提供する。
（列挙の JointAnchors/sections は #61、twist/edge は visual 段 #63/#64 で扱う。）

## ノード一覧（`src/apps/node-vj/nodes/`）

- **SineNode**: 入力 `t`(number, 未接続→timeSec) / params freq, amplitude, offset /
  出力 `out` = offset + amplitude·sin(2π·freq·t)。純粋。
- **NoiseNode**: 入力 `t`(未接続→timeSec) / params speed, seed, amplitude, offset /
  出力 `out` = offset + amplitude·noise3D(seed, t·speed, 0)（core value-noise, -1..1）。純粋。
- **RemapNode**: 入力 `in`(number) / params inMin,inMax,outMin,outMax,clamp(bool) /
  出力 範囲変換。退化範囲(inMin==inMax)は outMin を返す。純粋。
- **AddNode**: 入力 `a,b`(number, 未接続→param) / 出力 `a+b`。純粋。
- **SmoothNode**: 入力 `in`(number) / param factor(0..1) / 出力 EMA 平滑。
  フレーム間状態が要るため `createState`（{prev}）を使用（env 未使用）。

## 純粋ヘルパ

- `remap(v, inMin, inMax, outMin, outMax, clamp): number` を分離して単体テスト。

## データフロー例

- `PoseInput.motion → Remap(0..0.3 → 0.1..1.5) → RainVisual.baseSpeed`（動きを増幅反映）
- `Sine → RainVisual.baseSpeed`（自律パルス）

## 実装順（TDD）

1. `remap()` 純粋ヘルパ + テスト
2. Sine/Noise/Add/Remap/Smooth の各 NodeTypeDef + evaluate テスト（fake ctx）
3. registry 登録
4. tsc/build/全テスト、Playwright スモーク（5ノード追加・ライブ値）

## 検証

- `bun run test` 全件パス・`bunx tsc --noEmit` クリーン・マルチエントリ build 成功
- Playwright: ツールバーに 5 ノードが増え、追加してもエラーなし・出力ライブ値表示

## リスク

- Smooth の状態は createState 依存（env 未使用でも生成される点に注意）。
- 既定グラフは据え置きのため既存挙動・テストに影響なし。
