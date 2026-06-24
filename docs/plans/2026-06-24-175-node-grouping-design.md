# #175 ノードのグルーピング（まとめて移動）設計

- Issue: https://github.com/mishi5/three-art/issues/175
- 基点: #181（fix/181-node-to-front。最前面化と同じ onDown 箇所を触るため上に積む）

## 目的
複数ノードを永続グループにまとめ、グループ内のノードをクリック/ドラッグするとグループ全体を選択・一括移動できるようにする。最小スコープ＝「移動の塊」。

## データモデル（graph-doc.ts）
```ts
interface NodeGroup { id: string; name?: string; nodeIds: string[]; }
interface GraphDoc { version; nodes; connections; groups?: NodeGroup[]; }  // groups 追加（任意）
```
- `name` は #176（ラベル）で活用。今回は未設定可。
- 純データ（JSON 化可能）。

### 操作（純関数・テスト対象）
- `createGroup(g, id, nodeIds, name?)`: 2 件以上の nodeIds でグループ追加（既に他グループ所属のノードは新グループへ移動＝重複所属しない）。
- `removeGroup(g, groupId)`。
- `groupOfNode(g, nodeId): NodeGroup | undefined`。
- `removeNode`（既存拡張）: 削除ノードを全グループの nodeIds から除去し、メンバー 2 未満になったグループは解散。
- `replaceGraph`（既存拡張）: groups もコピー。

### serialize（serialize.ts）
- groups を round-trip。deserialize 時に「存在しない nodeId を除去」「メンバー 2 未満のグループを破棄」で健全化。

## エディタ（NodeEditor.ts）
- **グループ化**: 選択 2 件以上で `Cmd/Ctrl+G` → `createGroup`（history 記録）。コンテキストメニューにも「グループ化」。
- **解除**: `Cmd/Ctrl+Shift+G` → 選択ノードが属するグループを `removeGroup`（history 記録）。メニューに「グループ解除」。
- **選択の伝播**: ノードクリック/ドラッグ開始時、そのノードがグループ所属なら `selectedIds` をグループ全体に拡張（→ 既存の group ドラッグで一括移動）。Cmd/Ctrl+クリックの個別トグルは従来どおり（グループ拡張しない）。
- **描画**: 各グループのメンバー外接矩形を薄い枠で描き、左上にグループ名（あれば）を表示。
- 最前面化（#181）はグループ全体に適用。

## UNDO/REDO
- グループ化/解除は `history.record`（GraphDoc スナップショットに groups 含む）。選択伝播・最前面化は非記録。

## テスト
- `graph-doc.test.ts`: createGroup（2 未満は作らない・重複所属しない）/ removeGroup / groupOfNode / removeNode のグループ除去・解散 / replaceGraph の groups コピー。
- `serialize.test.ts`: groups round-trip / 不正 nodeId 除去 / 2 未満破棄。
- エディタ（キーバインド・選択伝播・描画）は Playwright スモーク＋手動。

## スコープ外
グループの折りたたみ（畳んで 1 ノード化）、入れ子グループ、グループ単位のコピー。ラベル編集 UI は #176。
