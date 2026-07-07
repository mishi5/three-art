# #259 シーン一覧とアセット一覧のパネル視覚差別化 設計

Issue: https://github.com/mishi5/three-art/issues/259

## 課題

サイドドックのシーンパネルとアセットパネルは行構造・配色がほぼ同一で、
開いているパネルがどちらか一目で判別できない。

## 方針（Issue の改善案の組み合わせ）

パネルごとの**アクセントカラー**を定義し、控えめな箇所（ヘッダ・アクティビティバー・
行の左ボーダー）へ一貫して適用する。加えて行の左端要素を差別化する
（シーン=番号バッジ / アセット=種別アイコン）。既存のダークトーン
（#16161c / #1c1c22 / #243042）に馴染む彩度に抑える。

## アクセントカラー

| パネル | 定数 | 値 | 由来 |
| --- | --- | --- | --- |
| シーン | `SCENE_ACCENT`（scene-panel.ts） | `#5b87b8` | 既存の選択色系統（#4a6a8a / #243042）を明るくした青 |
| アセット | `ASSET_ACCENT`（asset-panel.ts） | `#c08a4a` | 青の補色方向の琥珀。暗背景で判別できる彩度 |

他パネル（クリップボード・ノード追加・コントロール・設定）は accent 未指定＝従来表示。

## 変更点

### editor/side-dock.ts

- `SidePanelDef` に `accent?: string` を追加（未指定は従来表示）。
- 純関数 `activityButtonStyle(on, accent?)`: アクティビティバーのアイコン色。
  非アクティブは従来（transparent / #9ab）、アクティブは背景 #243042・色 accent（未指定は #cfe）。
- 純関数 `headerUnderline(accent?)`: パネルヘッダの下線。accent 指定時は
  `2px solid <accent>`、未指定は `2px solid transparent`（レイアウトを揺らさない）。
- ヘッダにパネルアイコン（SidePanelDef.icon を accent 色で）をタイトル左に表示。

### scene/scene-panel.ts

- `scenePanelDef` に `accent: SCENE_ACCENT` を設定。
- 行の左に 3px のアクセントボーダー（`border-left:3px solid SCENE_ACCENT`）。
- 行左端に番号バッジ（1,2,3…）。アクティブ行はバッジを accent 背景で反転し
  視認性を上げる。出力ピンバッジ（#174）・改名（#255）・削除・切替は既存を維持。
- `createRenderHold` / `finish` 一本化（#255）は変更しない。

### asset/asset-panel.ts

- `assetPanelDef` に `accent: ASSET_ACCENT` を設定。
- 行の左に 3px のアクセントボーダー。
- 行左端に種別アイコン（動画/画像/音声・accent 色）。サムネイルは従来どおり併存。
- 種別→アイコンの対応を `kindIcon(kind)` として export（テスト対象）。

### i18n.ts

- 種別アイコンの title 用に `assets.kind.image` / `assets.kind.video` / `assets.kind.audio`
  を ja/en で追加。

## テスト

- side-dock.test.ts: `activityButtonStyle` / `headerUnderline` の純関数テスト。
- scene-panel.test.ts: 番号バッジの表示（1,2,3…）・左アクセントボーダー・
  アクティブ行のバッジ反転（DOM スモーク）。既存 #255 テストは行構造変更
  （バッジが先頭に入る）に合わせてセレクタのみ更新（意味は不変）。
- asset-panel.test.ts: `kindIcon` の対応（image/video/audio で異なる SVG）・
  アクセント定数の形式。

## 互換性

- accent 未指定パネルは従来表示（ヘッダ下線は透明・アイコン色は従来値）。
- 自動クローズ（#228）・ピン留め・D&D・出力ピン（#174）・改名（#255）のロジックは不変。
