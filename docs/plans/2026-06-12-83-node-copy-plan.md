# 実装計画: 複数選択＋ノード複製（エッジ込み）

- 対象 Issue: https://github.com/mishi5/three-art/issues/83
- 親 Epic: https://github.com/mishi5/three-art/issues/56

## 確定方針（#83 ブレインストーミング）

- 選択モデル: `selectedIds: Set<ID>`。クリック=単独選択、Cmd/Ctrl+クリック=トグル、
  **空白左ドラッグ=矩形選択**。パンは **Space+ドラッグ／中ボタン／右ボタン** に移行
  （右クリックメニューは抑止）。選択グループはまとめてドラッグ移動、Del で全削除。
- 複製: **Cmd/Ctrl+C で即配置**（ペースト不要）。+24px オフセット、種別・手動 param・
  preview を引き継ぎ、複製群が選択状態になる。
- エッジ: 選択内→選択内は張り直し、**選択外→選択内（入力側）は維持**、
  **選択内→選択外（出力側）は複製しない**（外部入力ポートを後勝ちで奪い
  元の接続を破壊するため）。

## 実装

### 1. `graph/duplicate.ts`（純粋・TDD）
- `duplicateNodes(g, ids, genId, offset)` → 複製して g に追加し、新 id 配列を返す
- params は structuredClone、position は +offset、preview 引き継ぎ
- エッジ規則は上記 3 分類（registry 不要・有効グラフの複製は有効）

### 2. `editor/selection.ts`（純粋・TDD)
- `nodesInRect(nodes, registry, rect)` — ノード矩形（layout.nodeRect）との交差判定

### 3. `editor/NodeEditor.ts`
- `selected` → `selectedIds: Set<string>`（描画・削除・グループ移動対応）
- onDown: node=選択/トグル/グループドラッグ開始、空白=矩形選択 or（Space/中/右）パン
- onMove/onUp: 矩形更新→確定で選択置換、グループ移動はアンカー方式
- onKey: Del=選択全削除、Cmd/Ctrl+C=duplicateNodes→複製群を選択
- 矩形のオーバーレイ描画、ヒント文言更新、contextmenu 抑止、Space 押下追跡

## テスト

- duplicate: param/preview 引き継ぎ・新 id・内部エッジ張り直し・外→内維持・内→外除外・
  オフセット位置
- nodesInRect: 交差/非交差/複数
- 操作系は Playwright（矩形選択→Cmd+C→複製群が選択されグループ移動できる、
  パンが Space/右ドラッグで動く）

## リスク

- パン操作の変更は手癖に影響（ユーザ合意済み）。ヒント文言で案内
- Cmd+C はブラウザのコピーと衝突 → 対象があるときのみ preventDefault
