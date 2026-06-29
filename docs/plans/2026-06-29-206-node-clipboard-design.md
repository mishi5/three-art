# #206 ノードコピーのクリップボード化 設計

Issue: https://github.com/mishi5/three-art/issues/206

## 目的

ノードのコピーをアプリ内クリップボード＋履歴に拡張する。サイドパネルにコピー履歴を持ち、選択して Cmd+V で貼り付け、またはドラッグしてエディタへドロップ貼り付けできる。直近コピーは Cmd+V で貼れる。セッション内のみ・シーン横断で貼付可能。

## 挙動の変更

- 従来: **Cmd+C で選択ノードを即複製**（+24px）。
- 変更後: **Cmd+C = コピー**（選択ノード＋内部接続をクリップボード履歴に積む・グラフ非変更）、**Cmd+V = 貼付**（現在のクリップ項目をマウス位置へ）。標準的なコピペ挙動。
- 右クリックメニューの「複製」（`duplicateNodes`）は従来どおり残す。

## データ表現（シーン非依存）

`ClipItem { id; nodes: NodeInstance[]; connections: Connection[]; label }`
- `extractClip(graph, selectedIds)`: 選択ノードを deep clone、**両端が選択内の接続のみ**含める（外部接続は持たず自己完結＝別シーンへ貼れる）。
- `pasteClip(graph, registry, item, genId, {at|offset})`: ノードを再 id・内部接続を新 id へ remap・position を at（左上合わせ）or offset で移動し addNode/addConnection。新ノード id を返す。
- エッジ規則は `graph/duplicate.ts` の「選択内→選択内のみ張替」を踏襲。

## 履歴ストア（`NodeClipboard`）

- セッション内のみ（永続化なし）。`add`（先頭に積む・上限 24・current 更新）/ `list` / `get` / `current` / `setCurrent` / `onChange`。
- current = Cmd+V の貼付対象。

## UI

- サイドパネル `clipboardPanelDef(clipboard)`（side-dock に登録）。履歴一覧（ラベル＝ノード種別/件数＋接続数）。
  - **クリック → setCurrent**（現在項目を強調）。
  - **ドラッグ → dataTransfer に `CLIP_MIME`（application/x-node-vj-clip）＋項目 id**。
- `NodeEditor`:
  - Cmd+C: `makeClipItem` → `clipboard.add`。
  - Cmd+V: `clipboard.current()` を `pasteClip` でマウス位置へ。history.record で undo 対応・貼付ノードを選択。
  - `onDragOver`/`onDrop`: `CLIP_MIME` を受理し、ドロップ位置（world）へ `pasteClip`・current 設定。

## テスト

- 純ロジック `node-clipboard.test.ts`（extract/paste の往復・再 id 後も内部接続維持・外部接続規則・複数/空選択・履歴の上限と current 切替・ラベル）。
- 全976件パス（baseline 958 + 18）・`tsc --noEmit` クリーン。
- パネル/キー/D&D の UI は headless 検証困難＝手動確認。

## 手動確認

- ノード複数選択 → Cmd+C → クリップボードパネルに項目追加。
- Cmd+V でマウス位置へ貼付（接続も保たれる）。
- パネル項目クリック → Cmd+V でそれが貼られる。
- パネル項目をエディタへドラッグ&ドロップ → ドロップ位置へ貼付。
- 別シーンへ切替後も履歴保持・そこへ貼付可能。
- 右クリック「複製」は従来どおり。
