# #202 texture シーケンサノード（TextureSequencer）設計

Issue: https://github.com/mishi5/three-art/issues/202

## 目的

複数の texture 入力を受け取り、trigger の発火（立ち上がりエッジ）ごとに出力 texture を定義順に 1 つずつ
切り替え、末尾でループする（texture シーケンサ／セレクタ）。onset/拍の trigger と組み合わせ「拍でネタが
切り替わる」演出に使う。

## 設計判断

- **動的ポートは未対応**（NodeTypeDef.inputs は固定配列・生成後の追加機構なし。AudioMix も固定4入力）。
  → **固定 N=8 の texture 入力（tex1..tex8）** を定義し、**接続したスロットだけを定義順に巡回**する。
- 出力は選択中入力の texture を**そのままパススルー**（RT 不要・Screen/SceneInput と同じ思想）。
- trigger 立ち上がりエッジは FlipFlop と同じ `prevTrigger` パターンで検出。

## ポート

- 入力: `tex1`..`tex8`（texture）＋ `trigger`（次へ）＋ `reset`（先頭へ戻す）。
- 出力: `texture` ×1（接続なしは無出力＝undefined）。
- params: なし（手動 index 指定・方向・ランダム順は将来拡張）。

## 純ロジック（テスト対象）

`TextureSequencerNode.ts`:
- `sequencerStep(step, prev, cur)`: reset 立ち上がり→0（優先）/ trigger 立ち上がり→+1 / それ以外据え置き。
- `selectSeqPort(step, connectedPorts)`: 接続済みポート index 配列を `step % n` で wrap して選ぶ（接続なし null）。
  **step を毎フレーム接続数で wrap するため、接続数が変わっても index が破綻しない**。
- state `TextureSequencerRuntime { step, prevTrigger, prevReset }`。

evaluate: trigger/reset を Boolean 化し step 更新→prev 保存→接続済みスロット（`ctx.input(id)` が非 null）を
集めて `selectSeqPort` で選び、その入力 texture を出力。

## 受け入れ条件

- 複数 texture を接続し trigger ごとに出力が順番に切り替わる ✓
- 末尾の次で先頭へループ ✓（`step % n`）
- 接続数を変えても index が破綻しない ✓（毎フレーム接続数で wrap）

## テスト

- 純関数（sequencerStep の立ち上がり/reset 優先・selectSeqPort の wrap/接続数変化）＋ノード定義＋evaluate
  （順送り・ループ・接続なし無出力・reset・接続数変化で範囲内）。計9件。全1009件パス・型チェック通過。
- 実際の THREE.Texture 描画・エディタ接続は手動確認。

## 手動確認

- process メニューから TextureSequencer 追加 → 複数の texture 出力（VideoFile/TextureGenerator/Camera 等）を
  tex1.. へ接続、Pulse か AudioFileInput.onset を trigger へ接続 → Screen へ出力。
- trigger 発火ごとに映像が順番に切り替わり、末尾でループ。reset で先頭へ。
