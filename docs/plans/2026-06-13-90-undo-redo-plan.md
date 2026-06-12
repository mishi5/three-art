# 実装計画: エディタ操作の UNDO/REDO

- 対象 Issue: https://github.com/mishi5/three-art/issues/90
- 親 Epic: https://github.com/mishi5/three-art/issues/56
- 前提: #65（serialize/replaceGraph）

## 確定方針（#90 ブレインストーミング）

- **スナップショット方式**（操作直前のグラフ全体を structuredClone で履歴へ）。
  本グラフの規模（数十ノード・数 KB/枚）ではメモリ差は無意味で、実装の小ささと
  堅牢性が勝る。復元は `replaceGraph`。
- 履歴上限 **50**（超過は古い順に破棄）。record で redo スタックはクリア。
- キーは **Cmd+Z（UNDO）/ Shift+Cmd+Z（REDO）のみ**（Ctrl 系は割り当てない・ユーザ指定）。
- プリセット/YAML 読込は**履歴クリア**。preview トグル・パン・選択変更は記録しない。

## 1 操作の粒度（record ポイント＝変更直前）

- ノード追加（ツールバー）／削除（Del）／複製（Cmd+C）
- 配線確定（後勝ち置き換え含む。addConnection 失敗時は直前 record を破棄）
- 入力ポートクリック切断（既存接続がある場合のみ）
- param 編集 commit（オーバーレイ）
- スライダ：ドラッグで最初に動いた時点で 1 回（ドラッグ全体=1 操作）
- ノード移動（グループ）：ドラッグで最初に動いた時点で 1 回（確定=1 操作）

## 実装

### 1. `graph/history.ts`（純粋・TDD）
- `History { record(g); discardLast(); undo(current): GraphDoc|null; redo(current); clear(); canUndo; canRedo }`
- record: clone を undo へ push（cap 50）・redo クリア。undo: 現状態を redo へ退避し snapshot を返す。

### 2. NodeEditor 統合
- `history` をコンストラクタ注入（main で生成）
- 上記 record ポイントに `history.record(this.graph)` を挿入
  - group ドラッグ／param スライダは `moved` 初回遷移時に 1 回
  - wire-drop は record → addConnection、`!ok` なら `discardLast()`
- onKey: `e.metaKey && key.toLowerCase()==='z'`（INPUT 等は無視）→ shiftKey で redo / なしで undo。
  preventDefault。復元は `replaceGraph` 後、selectedIds を存続ノードに絞る

### 3. graph-io-bar
- `history` を受け取り、読込（preset/YAML）成功時に `history.clear()`

## テスト

- history 単体: record/undo/redo の状態遷移・redo クリア・cap 50・discardLast・clear
- 統合（純粋）: record → mutate → undo で元の GraphDoc と一致、redo で再適用
- Playwright: ノード追加→Cmd+Z で消える→Shift+Cmd+Z で戻る、param スライダ→undo、移動→undo

## リスク

- record 漏れ／二重 record → record ポイントを編集系操作のエントリに限定し E2E で確認
- 読込クリアの是非（Issue 要検討）→ クリアで確定（ユーザ確認済みの設計提示に異論なし）
