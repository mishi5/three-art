# #242 上部の操作方法テキストを撤去しヘルプポップアップへ移動 — 設計

対象 Issue: https://github.com/mishi5/three-art/issues/242

## 背景 / 現状

- 上部ツールバー（`NodeEditor.buildToolbar()`）の末尾に操作方法の常時表示テキストがある:
  `右クリック=メニュー / 空白ドラッグ=パン / Shift+ドラッグ=矩形選択 / Space・右ドラッグ=パン / ホイール=ズーム / 0=ズーム100% / Cmd+C=コピー / Cmd+V=貼付 / Del=削除`
- 長文のためツールバーが折り返して 2 行になりやすく、エディタ上部を圧迫する。
- #229 で操作モード（modern/legacy）が入ったが、テキストは modern 前提のままで
  legacy モードでは実際の挙動と食い違う。

## 方針

1. **常時表示テキストを撤去**し、ツールバー右端の「?」ボタンから開くヘルプポップアップへ移動する。
   - ツールバーはオーバーレイ（canvas は元々全画面）なので、撤去により折り返しが減って
     実質的にエディタ領域が広がる。ツールバー自体は 1 行のまま残るため、
     side-dock の `TOP = 44`（#230）等のレイアウト定数は変更不要。
2. **ヘルプ本文はデータ（セクション＋項目の配列）に集約**し、表示データ生成を純関数化する。
   - `helpSections(mode: PanSelectMode): HelpSection[]`（`help-content.ts`）
   - #244 で UI 文言を i18n 化する予定のため、文言はこの 1 ファイルに集約し散在させない。
3. **操作モード（#229）に応じてパン/矩形選択の記述を切り替える**。
   - modern: 空白左ドラッグ=パン / Shift+左ドラッグ=矩形選択
   - legacy: 空白左ドラッグ=矩形選択（パンは Space+左・中・右ドラッグ）
   - モードは `NodeEditor.panSelectMode`（prefs 由来・設定パネルが即時更新する値）を
     開くたびに読む（`getMode` クロージャ注入）。
4. **Esc / 外側クリックで閉じる**（#166 closeOnOutside / #228 と同パターン）。
   - アンカー（? ボタン）上の pointerdown では閉じない（click のトグルに委ねる。#166 と同じ理由）。

## モジュール構成

| ファイル | 内容 |
|---|---|
| `src/apps/node-vj/editor/help-content.ts` | `HelpItem`/`HelpSection` 型とヘルプ本文データ。`helpSections(mode)` 純関数 |
| `src/apps/node-vj/editor/help-content.test.ts` | 純関数のテスト（モード別の差し替え・共通項目・キーボード項目） |
| `src/apps/node-vj/editor/help-popup.ts` | `HelpPopup` クラス（open/close/toggle・Esc/外側クリックで閉じる・DOM 生成） |
| `src/apps/node-vj/editor/help-popup.test.ts` | happy-dom での開閉・Esc/外側クリック・モード反映テスト |
| `src/apps/node-vj/editor/NodeEditor.ts` | hint span 撤去・「?」ボタン追加（`margin-left:auto` で右端） |

## ヘルプの構成（セクション）

実装（NodeEditor / main.ts）から拾った実際の操作を整理する。

1. **マウス（パン・選択）** — モード依存
   - modern: 空白左ドラッグ=パン / Shift+左ドラッグ=矩形選択
   - legacy: 空白左ドラッグ=矩形選択 / Space+左ドラッグ=パン
   - 共通: 中・右ドラッグ=パン / ホイール・ピンチ=ズーム / 空白左クリック=選択解除 /
     右クリック=コンテキストメニュー（空白: ノード・ラベル追加 / ノード上: 複製・削除・名前編集）
2. **マウス（ノード・接続）** — モード共通
   - ノード左ドラッグ=移動（グループ所属はグループごと） / Cmd/Ctrl+クリック=選択に追加・除外 /
     出力ポートからドラッグ=接続（param 行へのドロップ可） /
     接続済み入力ポートをクリック=切断・ドラッグ=付け替え /
     param 行ドラッグ=スライダ編集・クリック=数値入力 /
     👁=ノードプレビュー切替 / 右下プレビュークリック=全画面切替
3. **キーボード** — モード共通
   - Space+ドラッグ=パン / Cmd+Z=元に戻す / Shift+Cmd+Z=やり直し /
     Delete・Backspace=選択ノード・ラベル削除 / Cmd+C・Cmd+V=コピー・マウス位置へ貼り付け /
     Cmd+G・Shift+Cmd+G=グループ化・解除 / 0=ズーム100% / Esc=プレビュー全画面解除

## スタイル

既存のメニュー/パネルと同トーン: `#16161c` 背景・`1px solid #444`・角丸 6px・`font:12px system-ui`・
`box-shadow:0 4px 16px rgba(0,0,0,0.5)`。セクション見出しは `addMenuLabel` と同じ
小さめ薄色（`#666` / 10px / uppercase 相当）。項目は 2 カラム（キー / 説明）。

## テスト方針（TDD）

- `helpSections`: セクション数・見出し・モード別項目の差し替え（modern⇄legacy）・
  共通項目やキーボード項目の存在・全項目が非空文字列であること。
- `HelpPopup`: happy-dom で toggle 開閉・Esc で閉じる・外側 pointerdown で閉じる・
  アンカー上 pointerdown では閉じない・モードに応じた本文差し替え・close でリスナ解除。
