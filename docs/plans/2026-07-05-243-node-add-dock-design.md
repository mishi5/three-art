# #243 ノード追加ボタンをサイドドックへ移動 — 設計

対象 Issue: https://github.com/mishi5/three-art/issues/243

## 背景 / 現状

- 上部ツールバー（`NodeEditor.buildToolbar()`）にカテゴリ別のノード追加ボタン群（#103・
  `input ▾ / generator ▾ / …`）が並び、クリックでドロップダウンから型を選んで追加している。
- ノード型の増加でツールバーが横に伸び、折り返して 2 行になりやすい（#242 でヘルプテキストは
  撤去済みだが、カテゴリボタンが残っている）。
- サイドドック（#151/#230）にパネルが集約されており、ノード追加も同じ作法へ寄せたい。

## 方針

1. **ツールバーのカテゴリボタン群を撤去**する。ツールバーには「出力値」デバッグトグルと
   右端の「?」ヘルプボタン（#242・`margin-left:auto`）だけを残す。
   - 「?」は元々 `margin-left:auto` で右端に寄せているため、ボタン撤去でレイアウトは崩れない。
   - `showCategoryDropdown()` と、そのトグル判定専用だった `menuAnchor`（#166）は不要になるため削除。
2. **サイドドックに「ノード追加」パネル（＋アイコン）を追加**する。
   - 一覧は **registry（`registry.list()`）から動的生成**（#227 のカテゴリ再整理に自動追従）。
     カテゴリ分けは右クリックメニューと同じ `groupNodesByCategory`（#103）を共有する。
   - セクション見出しは controls-panel / settings-panel と同スタイル
     （`color:#9ab;font-size:11px;font-weight:600`）。カテゴリ名は registry の category id を
     そのまま表示（CSS capitalize）し、固定文言を増やさない（#244 の i18n 化に備える）。
   - 各項目はノード名 + 説明（`def.description` の先頭 1 行・ellipsis）。`title` 属性に全文を持たせる。
3. **クリックでビューポート中央（見えている範囲の空き）に追加**する。
   - 既存の `NodeEditor.addNodeOfType(type, worldPos)`（履歴 record・追加ノード選択）を再利用。
     右クリックメニュー（node-menu 経路）と同じ追加処理。
   - 「見えている範囲」= ドック（アクティビティバー 40px + パネル 230px）の右端〜画面右端、
     ツールバー下（44px）〜画面下端。パネルを開いてクリックする操作なのでパネル幅は常に差し引く。
   - 「空き」= 既存ノード位置と近すぎる場合は右下へ 28px ずつずらす（`findFreeSpot` 純関数）。
4. **右クリックメニューからの追加は変更しない**（`showAddMenu` / `groupNodesByCategory` はそのまま）。
5. パネルの並び順: アセット / シーン / クリップボード / **ノード追加** / コントロール / 設定。
   （使用頻度が高いためコントロール・設定より前に置く。）
6. 自動クローズ（#228）との共存: パネル内クリックでは閉じない既存挙動（`shouldAutoClose` の
   `targetInPane`）のままなので、クリック追加を連続して行える。非ピン時は仕様どおり
   外側クリックで閉じる。変更なし。

## モジュール構成

| ファイル | 内容 |
|---|---|
| `src/apps/node-vj/editor/node-add-panel.ts` | `buildNodeAddSections` / `nodeAddViewRect` / `viewCenter` / `findFreeSpot` 純関数と `nodeAddPanelDef`（DOM mount） |
| `src/apps/node-vj/editor/node-add-panel.test.ts` | 純関数のテスト + happy-dom での mount/クリックテスト |
| `src/apps/node-vj/editor/side-dock.ts` | レイアウト定数 `BAR_W` / `TOP` / `PANEL_W` を export（値は不変） |
| `src/apps/node-vj/editor/NodeEditor.ts` | カテゴリボタン群と `showCategoryDropdown` / `menuAnchor` を撤去・`addNodeAtViewCenter(type, view)` を追加 |
| `src/apps/node-vj/main.ts` | `nodeAddPanelDef` を buildSideDock の 4 番目に配線 |

## 配置座標の決め方

```
screenCenter = viewCenter(nodeAddViewRect(innerWidth, innerHeight))
worldCenter  = screenToWorld(screenCenter, offset, scale)   // 現在のパン/ズームを反映
desired      = worldCenter - (NODE_WIDTH/2, TITLE_H)        // ノードが中央に見える top-left
pos          = findFreeSpot(desired, 既存ノード位置)         // 近接(40px 未満)なら +28,+28 ずつ回避
```

連続クリックでも `findFreeSpot` が直前の追加ノードを避けるため、同座標に重ならず
右下方向に並んでいく。

## スコープ外（将来案）

- **パネル項目のドラッグ＆ドロップ配置**: アセットパネル（#154）/ クリップボードパネル（#206）と
  同じ `dataTransfer` + `NodeEditor.onDrop` の作法で、項目をドラッグして任意位置に配置できるように
  する余地がある。MIME（例: `application/x-node-vj-node-type`）を追加し、drop 時に
  `addNodeOfType(type, worldPos)` を呼ぶだけで載る設計。本 Issue ではクリック追加のみ。
- パネル内の検索/フィルタ入力（型数がさらに増えたら検討）。

## テスト方針（TDD）

- `buildNodeAddSections`: カテゴリ順（groupNodesByCategory 準拠）・description の引き回し・
  description 無しは空文字。
- `nodeAddViewRect` / `viewCenter`: ドック右端〜画面右端・ツールバー下〜画面下端の中心。
- `findFreeSpot`: 空きならそのまま / 近接ノードがあれば右下へ回避 / 連鎖回避。
- `nodeAddPanelDef`: happy-dom で mount し、セクション見出しと項目が registry 順に並ぶこと・
  項目クリックで `onAdd(type)` が呼ばれること。
