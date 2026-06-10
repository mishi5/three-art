# 実装計画: 全数値パラメータの入力ポート化

- 対象 Issue: https://github.com/mishi5/three-art/issues/74
- 親 Epic: https://github.com/mishi5/three-art/issues/56
- 先行 ADR: `docs/plans/2026-06-07-59-graph-core-adr.md`

## 目的

すべての数値パラメータ（kind number/int）に接続可能な入力ポートを設け、接続時は
手動設定値を無視して入力数値で上書きする。

## 確定方針（#74 ブレインストーミング）

- 入力を 2 分類: **signal 入力**（pose/audio/texture・Sine の `t`・Remap の `in` など
  param を持たない純信号）と **param 入力**（数値 param）。
- エディタ表現: signal は上部入力行、**数値 param は param 行の左に接続ドット**。
- Multiply の `a/b`・RainVisual の `baseSpeed/count` 等の宣言済み数値入力も param 行ドットに統一。
- enum/boolean（mode/twistAxis/source/clamp）は接続不可（手動のみ）。
- 実効値の上書き表示・スライダは #75（本 Issue は接続能力＋ドット表示まで）。

## コア変更（ヘッドレス・TDD）

### 1. `graph/node-ports.ts`（新規・純粋）
- `paramInputs(def)`: 数値 param → `PortDef{id,label,type:"number"}`
- `signalInputs(def)`: `def.inputs` のうち同 id の param を持たないもの
- `effectiveInputPorts(def)`: `signalInputs ∪ paramInputs`（接続検証・評価で使う）
- `isParamInput(def, portId)`: その入力が数値 param 由来か

### 2. `graph/evaluator.ts`
- 各 effective 入力ポートを解決: 接続あり→上流値／なし→手動 param（あれば）／default。
- `ctx.input(id)` = 解決値。`ctx.param(id)` = **数値 param なら解決値（接続 override or 手動）**、
  非数値 param は手動値。→ 既存ノードの evaluate は無改修で全 param が override 対応。

### 3. `graph/graph-doc.ts`
- `addConnection` の入力ポート検証を `effectiveInputPorts` ベースに（`radius` 等へ接続可）。

### 4. `editor/`（Canvas2D）
- レイアウト: 上部に signal 入力（左）＋出力（右）。param 行は数値 param の左に接続ドット
  （port id = param id）。enum 等はドットなし。
- `layout.ts`: param 行ドット座標 `paramPortPos`。
- `NodeEditor`: hitPort・配線・描画を signal 入力 / param 行ドット / 出力に対応。

## 実装順（TDD）

1. node-ports 分類（paramInputs/signalInputs/effectiveInputPorts/isParamInput）→ テスト
2. evaluator の override 解決（radius 接続で手動無視・未接続フォールバック維持）→ テスト
3. graph-doc の effectiveInputPorts 検証 → テスト
4. layout の param ポート座標 → テスト
5. NodeEditor の描画・ヒット・配線対応 → ブラウザ確認
6. 既存全ノードの整合（Multiply/RainVisual 等が param 行ドットで接続）

## 検証

- `bun run test` 全件パス（既存挙動維持＋override 新規）・`bunx tsc --noEmit` クリーン・build 成功
- Playwright: 数値 param（例 PointCloudVisual.radius）へ Number 接続で手動値が無視され上書きされること、
  signal 入力（pose/audio/t）と出力の接続が従来通り動くことを確認

## リスク

- evaluator の解決変更は既存テストに影響しうる → 未接続フォールバック・接続 override の
  両方をテストで固定。
- エディタの param 行ドットでノードがやや縦長に（param 行は元々あるので増分は小）。
