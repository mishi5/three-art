# #258 エッジドロップで互換ノード選択（n8n 風）＋ノード追加パネルの右ドック化 設計

Issue: https://github.com/mishi5/three-art/issues/258

## 目的

1. 画面右側に新しいサイドドックを追加し、「ノード追加」パネル（#243）のみを左ドックから移す。
2. 出力ポートからの接続ドラッグを**空白で離したとき**、接続破棄の代わりに右ドックの
   ノード追加パネルを**互換フィルタ付き**で自動オープンし、選択でドロップ位置に追加＋自動接続する
   （n8n 流の接続起点ノード追加）。v1 は出力ポート起点のみ（入力起点・#178 regrab は従来どおり）。

## 構成

### 1. side-dock.ts の左右対応（汎用化）

- `buildSideDock(panels, pin, options?: { side?: "left" | "right" })`。
- 配置 CSS は純関数 `dockPlacement(side)` に切り出す（bar / pane の left/right・境界線・角丸・影）。
  - left（従来）: bar `left:0`・pane `left:BAR_W`・`border-right`・角丸 `0 6px 6px 0`。
  - right: bar `right:0`・pane `right:BAR_W`・`border-left`・角丸 `6px 0 0 6px`。
- 戻り値に `SideDockHandle { open(id), close(), activeId() }` を追加し、
  エッジドロップからのプログラム的オープンを可能にする（既存呼び出しは戻り値無視で互換）。
- `SidePanelDef.onHide?()` を追加。パネルが非アクティブ化（別パネル切替・collapse・自動クローズ）
  したときに呼ぶ。ノード追加パネルはここでフィルタを解除する。
- `options.onActiveChange?(id)`: PiP のレイアウト追随（右ペイン開閉で右下 PiP を左へ避ける）用。
- 自動クローズ/ピン（#228）は左右それぞれ独立に適用。ピン状態の prefs キーは
  左 `dockPinned`（従来）/ 右 `dockPinnedRight`（新設）。
- pane に `data-role="dock-pane"` を付け、パネル側から「ペイン外クリック」を判定できるようにする。

### 2. prefs

- `dockPinnedRight: boolean`（既定 false）を追加。parsePrefs / DEFAULT_PREFS に 1 行ずつ。

### 3. 互換フィルタ（純関数）

- `graph/node-ports.ts` に追加:
  - `firstCompatibleInput(def, fromType)`: `effectiveInputPorts`（paramInputs 含む・#74）のうち
    `isCompatible(fromType, p.type)` な最初の入力ポート。自動接続先の決定に使う。
  - `compatibleNodeTypes(defs, fromType)`: 互換入力ポートを 1 つ以上持つノード型名の配列。
- `editor/node-add-panel.ts`:
  - `buildNodeAddSections(defs, allowedTypes?)`: フィルタ引数を追加（#256 のレイアウト改修と干渉
    しないよう一覧生成に絞る）。allowedTypes 指定時は該当型のみ・空セクションは落とす。
  - `wireDropPosition(drop, occupied)`: ドロップ位置（world）→ ノード配置座標。
    入力ポート側（左上）が drop 付近に来るよう y を TITLE_H ぶん上げ、findFreeSpot で重なり回避。
  - `nodeAddViewRect(innerW, innerH)`: 右ドック化に伴い可視領域を
    「左バー右端 〜 右ドック（バー+パネル）左端」に変更。

### 4. ノード追加パネルのフィルタ状態

- `createNodeAddPanel(deps)` を新設し `{ def, setFilter, clearFilter }` を返す
  （`nodeAddPanelDef(deps)` は def だけ返す従来 API として維持）。
- `NodeAddFilter { portType, types: ReadonlySet<string>, onPick(type) }`。
- フィルタ中はヘッダに「{type} に接続可能」バッジ＋解除ボタン（i18n: `nodeAdd.filter.*`）。
  - 項目クリック → フィルタ解除 → `onPick(type)`（追加＋自動接続は呼び出し側）。
  - キャンセル: Esc（window keydown・capture）/ ペイン外 pointerdown（capture）/ 解除ボタン /
    パネル非表示（`onHide`）→ フィルタ解除のみ（何も追加しない）。
  - 表示データ生成は純関数（バッジ文言 `filterBadgeText`・一覧は buildNodeAddSections）。
- #228 の自動クローズは pointerdown 起点なので、エッジドロップ（pointerup）でのオープンが
  直後に閉じられることはない（ドロップの pointerup はパネル外クリック扱いにならない）。

### 5. NodeEditor（接続ドラッグの onUp）

- `onWireDropOnEmpty?: (info: { fromNode, fromPort, portType, worldX, worldY }) => void` を追加。
- wire ドラッグ終了時、以下すべてを満たすときだけ発火（既存挙動は不変）:
  - 出力ポート起点（`regrab` でない）・DRAG_THRESHOLD 以上動かした
  - ドロップ先の hitTest が null（空白）。ノード上（接続成立/破棄）は従来どおり。
- `addNodeAtWireDrop(type, dropWorld, from)`: パネルで選択された型をドロップ位置へ追加し、
  `firstCompatibleInput` へ自動接続。履歴は `addNodeOfType`（record 済み）→ `addConnection`
  （record しない）の順で **追加＋接続が 1 undo**。接続不能（循環等）でも追加は残す。

### 6. main.ts 配線

- 左ドック: アセット/シーン/クリップボード/コントロール/設定（従来どおり）。
- 右ドック: ノード追加パネルのみ。`buildSideDock([nodeAdd], pinRight, { side: "right", onActiveChange })`。
- `editor.onWireDropOnEmpty` で `compatibleNodeTypes` を計算 → `setFilter` → 右ドック `open("node-add")`。
  `onPick` は `editor.addNodeAtWireDrop`。
- PiP（右下 12px）: 右バーぶん常に `BAR_W + 12` 右マージン、右ペイン展開中はさらに `PANEL_W` 退避。

## テスト

- 純関数: `dockPlacement` / `compatibleNodeTypes` / `firstCompatibleInput` /
  `buildNodeAddSections`（フィルタあり）/ `wireDropPosition` / `nodeAddViewRect`（右ドック版）/
  バッジ表示データ / `parsePrefs`（dockPinnedRight）。
- DOM（happy-dom）: フィルタ付きパネルのバッジ表示・解除ボタン・Esc/外側クリックでの解除・
  フィルタ中クリックで onPick が呼ばれること。
- 既存テストの追随: `nodeAddViewRect` の期待値変更。

## 影響しないこと

- 左ドックの他パネル・入力ポート起点のドラッグ・ノード上で離した場合の接続成立/破棄・
  右クリックメニューからの追加・パネル内部の行レイアウト（#256 で多列チップ化予定）。
