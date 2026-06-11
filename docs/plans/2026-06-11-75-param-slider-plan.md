# 実装計画: パラメータ編集UX改善（param 行ドラッグスライダ）

- 対象 Issue: https://github.com/mishi5/three-art/issues/75
- 親 Epic: https://github.com/mishi5/three-art/issues/56
- 先行: #74（全数値 param の入力ポート化）

## 目的

数値パラメータの手動設定を param 行の直接ドラッグ（スライダ）で行えるようにする。
※「接続時の実効入力値表示」は #74 で実装済み（接続中の param 行は上流ライブ値を緑表示）。

## 確定方針（#75 ブレインストーミング）

- **横ドラッグ（3px 以上）= 値の増減**
  - min/max あり: 行をスライダとして**絶対位置**で値決定（step スナップ・clamp・int 丸め）
  - min/max なし: **相対スクラブ**（value += dx × step、既定 step=0.1）
- **クリック（ドラッグなし）= 従来の数値入力オーバーレイ**（正確な値の入力用）
- enum/boolean は従来通り（クリックで select/入力）
- **接続中の数値 param はドラッグ無効**（上流値が支配）
- min/max を持つ行に**フィルバー**表示（接続中はライブ値でフィル）

## 実装

### 1. `editor/slider-logic.ts`（純粋・TDD）
- `absoluteSliderValue(x, rowLeft, rowWidth, pd)`: 位置→値（min/max 前提、step スナップ、clamp、int 丸め）
- `scrubValue(current, dx, pd)`: 相対スクラブ（dx×step、min/max あれば clamp、int 丸め）
- `fillRatio(value, pd)`: フィルバー割合（min/max なしは null）

### 2. `editor/NodeEditor.ts`
- Drag union に `{ kind:"param", nodeId, paramIndex, moved, lastX }` を追加
- onDown: param 行ヒット時にドラッグ候補開始（接続中の数値 param は除く）
- onMove: |累計 dx| ≥ 3px で moved=true、以降 slider-logic で値更新
- onUp: moved でなければ従来の editParam（オーバーレイ）
- drawNode: min/max 持ち数値 param 行にフィルバー（接続中はライブ値）

## テスト

- slider-logic: snap/clamp/int/相対スクラブ/fillRatio をユニットテスト
- エディタ操作は Playwright（ドラッグで値が変わる・クリックで入力が開く）＋手動確認

## リスク

- クリックとドラッグの判別（3px 閾値）は #63 のプレビュー拡大トグルと同じパターンで実績あり
- 既存の param 編集（クリック→オーバーレイ）の挙動は維持
