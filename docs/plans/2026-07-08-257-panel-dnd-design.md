# #257 ノード追加パネルからドラッグ＆ドロップでノードを配置 設計

Issue: https://github.com/mishi5/three-art/issues/257

## 目的

ノード追加パネル（#243/#256/#258）の各チップから**ドラッグ開始 → キャンバス上の任意位置へ
ドロップ**でノードを配置できるようにする。既存の**クリック追加（ビュー中央＋重なり回避）は維持**し、
両方使える状態にする。

## 実装方式の選定（既存 D&D との整合）

アセットパネル（`asset/asset-panel.ts`）・クリップボードパネル（`editor/clipboard-panel.ts`）は
いずれも **HTML5 Drag and Drop API**（`row.draggable = true` + `dragstart` で
`dataTransfer.setData(mime, id)` + `effectAllowed = "copy"`）を使い、受け側の
`NodeEditor`（`editor/NodeEditor.ts`）が canvas に `dragover`/`drop` リスナーを持ち、
`dataTransfer.getData(mime)` で種別を判別している。ポインタベースの自前実装は使われていない。

一貫性のため、本 Issue も同じ HTML5 DnD 方式を採用する。

- MIME: `application/x-node-vj-node-type`（既存の `application/x-node-vj-asset` /
  `CLIP_MIME = "application/x-node-vj-clip"` と同じ命名規則）。
- ゴースト表示: `dataTransfer.setDragImage` 等の追加実装はしない。ネイティブ D&D は既定で
  ドラッグ元要素の半透明コピーをカーソル追従で描画するため、チップの `dragstart` に
  `draggable=true` を付けるだけで「ノード名チップのカーソル追従プレビュー」が得られる
  （アセット/クリップボード両パネルも同様に追加実装なしで運用中）。過剰実装を避ける。

## 変更点

### 1. `editor/node-add-panel.ts`

- `NODE_TYPE_MIME` を export（新設）。
- `panelDropPosition(drop: {x,y}): {x,y}`（純関数・新設）: ドロップ位置（world）→ ノード配置座標。
  `wireDropPosition` と同じ考え方で入力ポート側が drop 付近に来るよう `TITLE_H` ぶん y を上げるが、
  **`findFreeSpot` は使わない**（Issue 記載どおり、ユーザが狙って落とした座標にそのまま置く）。
- チップ生成（`mountNodeAddPanel` 内）に `chip.draggable = true` と `dragstart` リスナーを追加。
  `dataTransfer.setData(NODE_TYPE_MIME, item.type)` + `effectAllowed = "copy"`。
  クリックの `click` リスナーはそのまま残す＝クリック追加とドラッグ追加は共存する
  （ネイティブ D&D は「実際に移動を伴うドラッグ」でのみ `dragstart` が発火し `click` を伴わない。
  移動を伴わないプレスは従来どおり `click` になるため、二重発火はしない）。

### 2. `editor/NodeEditor.ts`

- `onDragOver`: 許可 MIME 一覧に `NODE_TYPE_MIME` を追加。
- `onDrop`: `dataTransfer.getData(NODE_TYPE_MIME)` があれば新設メソッド
  `addNodeAtDropPoint(type, { x: e.clientX, y: e.clientY })` を呼んで返す（アセット/クリップの
  分岐と同じ並びに追加）。
- `addNodeAtDropPoint(type, screen)`（新設・公開メソッド）: `screenToWorld` で world 変換し、
  `panelDropPosition` を通した座標を `addNodeOfType(type, pos)`（履歴 record 込み・接続なしの
  単純追加）へそのまま渡す。`addNodeAtWireDrop` 相当（自動接続）は使わない。

main.ts 側の配線は不要（`NodeEditor` の canvas dragover/drop は既存のまま、ハンドラ内部で
分岐が増えるだけ）。

## #228（非ピン時のパネル自動クローズ）との整合

`side-dock.ts` の自動クローズは **`pointerdown`（capture）** を起点に
`shouldAutoClose({ pinned, paneOpen, targetInBar, targetInPane })` で判定している。

チップのドラッグは必ず「チップ上での pointerdown（= パネル内 = `targetInPane` true）」から始まる
ため、その時点で自動クローズは発火しない。ネイティブ HTML5 D&D はドラッグ中・ドロップ完了時に
ブラウザが `dragover`/`drop`/`dragend` を発火するのみで、新たな `pointerdown` を合成しない
（`pointerup` も出ない）。したがって、**ドラッグ開始点がパネル内である限り、既存の
`targetInPane` 判定だけで衝突は起きない**。

happy-dom でも `DataTransfer` は生成でき `setData`/`getData`
は動くが、`new DragEvent(type, { dataTransfer })` はコンストラクタ経由では `dataTransfer` が
渡されない（未実装）ことを確認した。イベント生成後に `event.dataTransfer = dt`（または
`Object.defineProperty`）で直接代入すれば実 `DataTransfer` として動作することも確認済み
（テストで使用）。この制約以外は実ブラウザと同じ経路で smoke テストできるため、追加のモジュール内
state による代替は不要と判断した。

実機（Chromium/Playwright）でも「チップをドラッグしてキャンバスへドロップしてもパネルが閉じない・
ドロップ位置にノードが追加される」ことを手動確認する。

## テスト方針

- 純粋関数: `panelDropPosition`（新設）。
- DOM smoke: チップに `draggable=true` が付与されること、`dragstart` で
  `dataTransfer.setData(NODE_TYPE_MIME, type)` が呼ばれること（手動生成した `DataTransfer` を
  イベントに代入して dispatch）。
- 既存のクリック追加（`click` → `onAdd`）のテストは変更しない（回帰確認）。
- `NodeEditor.ts` は元々ユニットテストの対象外（canvas/registry/history 一式が必要な統合対象で、
  既存の `addNodeAtWireDrop`/`onDropAsset` 等も同様に unit test が無い）。今回の
  `addNodeAtDropPoint`/`onDrop` の分岐追加もこの既存境界を踏襲し、新規のユニットテストは追加しない
  （手動 + 実ブラウザ確認でカバー）。

## 受け入れ条件（Issue 記載を再掲）

- [ ] パネルからキャンバスへ D&D でノードが落とした位置に追加される（Cmd+Z 可）
- [ ] クリック追加は従来どおり
- [ ] ドラッグ操作でパネルが誤って閉じない
- [ ] 全テストパス
