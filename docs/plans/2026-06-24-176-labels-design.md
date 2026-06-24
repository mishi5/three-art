# #176 エディタにラベル（ノード/グループ単位＋自由ラベル）設計

- Issue: https://github.com/mishi5/three-art/issues/176
- 基点: #175（feature/175-grouping。group.name を活用するため上に積む）。#175 は #181 の上。

## 目的
エディタに注釈ラベルを置けるようにする。ノード単位・グループ単位のラベル付けと、任意位置の自由ラベルを提供する。

## データモデル（graph-doc.ts）
- `NodeInstance.label?: string`（ノードの注釈/別名）。
- `interface TextLabel { id: string; x: number; y: number; text: string; }`（world 座標）。
- `GraphDoc.labels?: TextLabel[]`。
- グループ名は #175 の `NodeGroup.name` を使用。
- 操作: `addLabel(g, label)` / `removeLabel(g, id)`（移動は x/y 直接更新）。`replaceGraph` で labels コピー。
- serialize: `labels` と `node.label` を round-trip（形不正な label は破棄）。

## エディタ（NodeEditor.ts）
### 自由ラベル
- 追加: 空白右クリックメニューに「ラベル追加」→ その world 位置に空テキストの label を作りインライン編集を開く（履歴記録）。
- 編集: ラベルをダブルクリック → インライン input（Enter 確定/Esc 取消、空なら削除）。
- 移動: ラベルをドラッグ（新しい drag kind "label"）。最初に動いた時点で履歴記録。
- 削除: 選択して Del、またはラベル右クリック「削除」。
- 描画: world 空間にテキスト（背景の薄い角丸）。ヒットテストはテキスト矩形で簡易判定（hitTest とは別に label 専用判定）。

### ノードラベル
- ノード右クリックメニューに「ラベル編集」→ インライン input（タイトル下に表示）。`NodeInstance.label`。
- 描画: タイトル直下に小さめのラベル行（あるときのみ・ノード高さは変えず TITLE 下に重ねず、タイトル内右寄せ等は複雑なのでタイトル下の余白に 1 行）。実装簡便のためタイトルバー内に "type — label" 形式で併記する案も可。→ タイトル下に薄色で 1 行表示（ノード矩形内、ポート行の前）にすると高さ計算に影響。**簡便策: タイトルテキストを `type` の右に label を薄色併記**（高さ不変）。

### グループ名
- グループ内ノード右クリックメニューに「グループ名編集」→ インライン input → `group.name` 更新（#175 描画で表示済み）。

## UNDO/REDO
- ラベル追加/編集/移動/削除、ノードラベル編集、グループ名編集は履歴記録（GraphDoc スナップショットに labels/label/name 含む）。

## テスト
- `graph-doc`/`serialize`: labels round-trip・形不正破棄、node.label round-trip（TDD）。
- エディタ（追加/編集/移動/削除・ノードラベル・グループ名）は Playwright スモーク＋手動。

## スコープ
- 含む: 自由ラベル、ノードラベル併記、グループ名編集。
- 含まない: ラベルの色/フォント指定、リッチテキスト、ラベルのグループ化。
