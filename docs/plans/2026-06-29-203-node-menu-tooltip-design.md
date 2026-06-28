# #203 ノード追加メニューの説明ツールチップ 設計

Issue: https://github.com/mishi5/three-art/issues/203

## 目的

ノード追加メニューの各項目に一定時間 hover すると、そのノードの説明（description）と入出力ポートの
概要をツールチップで表示する。ノード種類が増え名前だけでは役割が分かりにくいため、追加前に確認できるようにする。

## 既存資産

- ノード定義は `NodeTypeDef.description` と `inputs/outputs`（`PortDef{ label, type }`）を持つ。
- `editor/tooltip.ts` に純関数 `tooltipBox`（画面端反転・クランプ）と `wrapLines` があり、canvas 内ホバー
  ツールチップ（`drawTooltip`）で使用済み。ただしノード追加メニューは **HTML DOM**（`NodeEditor` の
  `addMenuItem` / `openSubmenu` / `showCategoryDropdown`）なので、メニュー用は DOM ベースで別途実装する。

## 実装

### 純関数（テスト対象）
`editor/tooltip.ts` に `nodeMenuTooltipContent(def)` を追加:
- 入力: `NodeTypeDef | undefined`。
- 出力: `{ title: ノード type, body: description, ports: "in <label:type, …>   out <label:type, …>" } | null`。
- description もポートも無ければ `null`（出すものが無い）。

### DOM 配線（`NodeEditor.ts`）
- `addMenuItem(menu, text, onClick, tooltipType?)` に第4引数 `tooltipType` を追加。ノード型項目
  （`openSubmenu` / `showCategoryDropdown`）だけが type を渡す（シーン選択・ラベル追加等は渡さない）。
- 項目に `mouseenter` で `MENU_TOOLTIP_DELAY_MS = 500ms` の遅延後にツールチップ DOM を表示、
  `mouseleave` でタイマー解除＋非表示。
- 表示位置は項目の右上を基準に `tooltipBox` で画面端を回避（純関数を流用）。
- ツールチップは単一の DOM 要素を都度生成/破棄。`closeSubmenu`/`closeContextMenu` でも確実に破棄。

## テスト

- `tooltip.test.ts` に `nodeMenuTooltipContent` のユニットテスト4件（description＋ポート整形・undefined→null・
  description 無しでもポートがあれば返す・両方無しは null）。
- DOM のホバー遅延・配置は headless 検証が難しいため手動確認に委ねる。
- 全904件パス（baseline 900 + 4）・`tsc --noEmit` クリーン。

## 手動確認

- ノード追加メニュー（空白右クリック→カテゴリ→型、またはツールバーのカテゴリボタン）で型項目に
  500ms ほど hover → 説明＋入出力ポートのツールチップが出る。離れると消える。画面端で見切れない。
