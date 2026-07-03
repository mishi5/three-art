# #229 矩形選択を #207 以前の操作に戻せるオプション設定

Issue: https://github.com/mishi5/three-art/issues/229

## 目的

#207 で「空白左ドラッグ＝パン / Shift+左ドラッグ＝矩形選択」に変更したが、
従来（#83〜#206）の「空白左ドラッグ＝矩形選択」に慣れたユーザ向けに、
操作モードを設定で切り替えられるようにする。既定は現行（modern）のまま。

## 仕様

- 操作モード（`PanSelectMode`）:
  - **`modern`（既定・#207 現行）**: 空白左ドラッグ＝パン / Shift+左ドラッグ＝矩形選択。
  - **`legacy`（#207 以前）**: 空白左ドラッグ＝矩形選択（Shift 有無を問わない）。
    パンは Space+左ドラッグ・中ボタン・右ドラッグ（modern と同じ経路）。
- 設定は localStorage（`node-vj.prefs.v1`）に永続化し、再読込後も保持する。
- 設定 UI は左サイドドックに「設定」パネルを新設して置く。
- #207 の「空白左クリック（移動なし）＝選択解除」は legacy でも維持される
  （legacy では空矩形クリック＝何も拾わない→選択解除、で従来どおり整合）。

## 構成

### 1. `src/apps/node-vj/prefs.ts`（新規）

軽量な UI 設定の localStorage 永続化。**後続 Issue（#228 サイドバーのピン状態）でも
共用する**汎用モジュールとして設計する。

- `Prefs` 型 + `DEFAULT_PREFS`: 全設定を 1 つの JSON オブジェクトで保持。
  フィールド追加時は型・既定値・`parsePrefs` の検証を 1 行ずつ足すだけ。
- `parsePrefs(raw: string | null): Prefs`（純関数・テスト対象）:
  JSON パース→既定値マージ。壊れた JSON / 不正値はフィールド単位で既定へフォールバック。
- `PrefsStore`（`KvStorage` ベース・SceneStore と同パターン）:
  - `load(): Prefs`
  - `save(patch: Partial<Prefs>): void` — read-modify-write（他フィールドを保持）。

### 2. `editor/pan-policy.ts`（変更）

`backgroundPointerDrag` に `mode: PanSelectMode` を追加。

| 入力 | modern | legacy |
| --- | --- | --- |
| 中/右ボタン, Space+左 | pan | pan |
| 左単独 | pan | **rect** |
| Shift+左 | rect | rect |

### 3. `editor/NodeEditor.ts`（変更）

- 公開フィールド `panSelectMode: PanSelectMode = "modern"` を追加（他の任意フックと同パターン）。
- `onDown` の背景分岐で `backgroundPointerDrag` にモードを渡す。
- ノード上のパン（中/右/Space+左）・#207 の空クリック選択解除は両モード共通で変更なし。

### 4. `editor/settings-panel.ts`（新規）

サイドドック用「設定」パネル（clipboard-panel と同パターン・DOM は手動確認）。

- `settingsPanelDef(actions): SidePanelDef` — 歯車アイコン。
- 「パン / 矩形選択の操作」セクションに modern / legacy の 2 択ボタン
  （現在値をハイライト・説明文つき）。クリックで `setPanMode` →prefs 保存→即反映。

### 5. `main.ts`（変更）

- `PrefsStore` を生成し、起動時に `editor.panSelectMode` へ注入。
- `buildSideDock` の配列に `settingsPanelDef` を追加（末尾）。

## テスト（TDD）

- `prefs.test.ts`: parsePrefs（正常/壊れた JSON/不正値/部分指定/未知キー）、
  PrefsStore の load/save ラウンドトリップ（memoryAdapter）。
- `pan-policy.test.ts`: 既存ケースを modern として維持 + legacy 分岐のケースを追加。
