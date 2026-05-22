# UI 配置再設計 Implementation Plan

**Goal:** Quick Actions バー (頻用ボタン集約) を新設し、lil-gui からは Preset 系の頻用ボタンを除去・トップレベルフォルダをタブ化することで、UI のスクロール量と誤タップを減らす。

**Tech Stack:** TypeScript, Bun (`bun test`), lil-gui 0.21

設計: `docs/plans/2026-05-23-ui-redesign-design.md`
Issue: https://github.com/mishi5/three-art/issues/34

---

## File Structure

- `src/pose-particles/ui/QuickActionsBar.ts` (新規): Quick Actions DOM の構築・コールバック配線・undo ボタン状態管理
- `src/pose-particles/ui/QuickActionsBar.test.ts` (新規): DOM 構造 / コールバック発火 / setUndoEnabled / dispose のテスト
- `src/pose-particles/ui/SettingsPanel.ts` (改修): Preset 系ボタン除去、`randomize`/`undoRandomize`/`canUndoRandomize`/`setOnUndoStateChange` の公開、タブバー追加
- `src/pose-particles/ui/SettingsPanel.test.ts` (新規 or 拡張): タブ排他切替・Preset folder 内訳の検査
- `src/pose-particles/ui/UI.ts` (改修): `showControlPanel` 廃止、`showStartOverlay` のみ残す
- `src/pose-particles/App.ts` (改修): `QuickActionsBar` の wiring (randomize / undo / Preset 操作 / 音声ソース)

---

### Task 1: `QuickActionsBar` TDD (DOM + コールバック)

**Files:**
- Create: `src/pose-particles/ui/QuickActionsBar.ts`
- Test: `src/pose-particles/ui/QuickActionsBar.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

  - 構築時に `data-action="randomize"` `undo-randomize` `open-manager` `next-preset` `random-preset` の 5 ボタン、`data-audio-source="file"` `mic` `display` の 3 ボタンが DOM 上に存在する
  - 各ボタンクリックで対応する callback が 1 度呼ばれる (`mock` で確認)
  - `setUndoEnabled(false)` で undo ボタンの `disabled` 属性が `true` になる
  - `setAudioStatus("再生中: foo.mp3")` でステータスエリアにテキストが反映される
  - `setVisible(false)` でルート要素の `display` が `none` になる
  - `dispose()` で `document.body` から root が除去される

- [ ] **Step 2: 最小実装でテストを通す**

  - `QuickActionsBar` クラスを実装
  - root を作成し `document.body` に append
  - 5+3 のボタンを作成、`addEventListener("click", ...)` で callback を呼ぶ
  - `setUndoEnabled` / `setVisible` / `setAudioStatus` / `dispose` を実装

- [ ] **Step 3: テスト全件パス確認**

  ```sh
  bun test src/pose-particles/ui/QuickActionsBar.test.ts
  ```

---

### Task 2: `SettingsPanel` の Preset 系ボタン除去 + 公開 API

**Files:**
- Modify: `src/pose-particles/ui/SettingsPanel.ts`
- Test: `src/pose-particles/ui/SettingsPanel.test.ts` (新規)

- [ ] **Step 1: 失敗するテストを書く**

  - `SettingsPanel` を構築後、`gui.controllersRecursive()` の名前一覧に
    - `randomize (current mode)` が **存在しない**
    - `undo randomize` が **存在しない**
    - `manage presets…` が **存在しない**
    - `next preset ▶` が **存在しない**
    - `random preset` が **存在しない**
    - `reset to defaults` / `export preset (.yaml)` / `import preset (.yaml)` は **存在する**

- [ ] **Step 2: 該当ボタンを除去**

  - `SettingsPanel.ts` 内 `presets.add(randomizeActions, "randomize")…` 以下を削除
  - `presets.add(managerActions, "manage")…` 以下を削除
  - `undoController` 関連も Quick Actions 経由制御に切り替えるため、内部参照のみ残し外部公開する形に変更

- [ ] **Step 3: 公開 API を追加 (テストファースト)**

  追加テスト:

  - `panel.randomize()` を呼ぶと `canUndoRandomize()` が `true` を返す
  - `panel.undoRandomize()` を呼ぶと `canUndoRandomize()` が `false` を返す
  - `setOnUndoStateChange(cb)` 登録後、`randomize()` で `cb(true)` が、`undoRandomize()` で `cb(false)` が呼ばれる
  - `applyPreset()` `reset()` 等の現行テストは引き続きパス

- [ ] **Step 4: 実装**

  - `private randomize()` → `randomize(): void` (public)
  - `private undoRandomize()` → `undoRandomize(): void` (public)
  - `canUndoRandomize(): boolean` (this.prevSnapshot !== null)
  - `setOnUndoStateChange(cb): void` (内部に保持し、randomize/undoRandomize の最後に発火)
  - `undoController` (lil-gui) の管理は削除し、外部 callback による状態反映に変更

- [ ] **Step 5: テスト全件パス確認**

  ```sh
  bun test src/pose-particles/ui/
  ```

---

### Task 3: `SettingsPanel` のタブ化

**Files:**
- Modify: `src/pose-particles/ui/SettingsPanel.ts`
- Test: `src/pose-particles/ui/SettingsPanel.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

  - `SettingsPanel` 構築直後に `gui.domElement.parentElement` 内へタブバー (`data-role="settings-tabs"`) が挿入されている
  - タブバーに `Audio` / `Look` / `Particles` / `Mode` / `Post-process` / `System` の 6 ボタンが存在する
  - 初期状態で `Audio` タブが active (class `qa-tab-active`)、対応する lil-gui folder のみ open、他は close
  - タブボタンクリックで対応 folder のみ open、他は close

- [ ] **Step 2: 実装**

  - `private buildTabBar(): HTMLDivElement`
  - `private switchTab(active: string): void` で `topFolders` のうち active のみ `open()`、他は `close()`
  - タブバーを `gui.domElement` の親に挿入 (lil-gui の DOM 階層を直接いじらない位置に)
  - 初期 active = `Audio`
  - CSS class `qa-tab-active` を当て、簡易インラインスタイルを設定

- [ ] **Step 3: テスト全件パス確認**

  ```sh
  bun test src/pose-particles/ui/
  ```

---

### Task 4: `UI.ts` の `showControlPanel` 廃止 + `QuickActionsBar` 統合

**Files:**
- Modify: `src/pose-particles/ui/UI.ts`
- Modify: `src/pose-particles/App.ts`

- [ ] **Step 1: `UI.ts` から `showControlPanel` 関連を削除**

  - `private mode` フィールド、`switchToFile/Mic/Display`、`displayErrorMessage` を削除
  - `showStartOverlay` のみ残す
  - 既存呼び出し元 (`UI.showControlPanel`) を `App` から外す

- [ ] **Step 2: `App.ts` で `QuickActionsBar` を初期化・wiring**

  - `App` constructor の末尾で `this.quickActions = new QuickActionsBar({...})` を作成
  - Randomize: `() => { this.settingsPanel.randomize(); }` (undo enable は `setOnUndoStateChange` 経由で自動同期)
  - Undo: `() => { this.settingsPanel.undoRandomize(); }`
  - Preset Manager: `() => { this.presetManager.show(); }`
  - Next preset / Random preset: 既存 `SettingsPanel` callbacks の中身をそのまま展開
  - Audio source `file`: 現在の file input UI を Quick Actions の直下に展開 (file 選択時 input が出現)
  - Audio source `mic` / `display`: 現 `switchToMic` / `switchToDisplay` 相当を `App` に持ち込み、結果を `quickActions.setAudioStatus()` に反映
  - `settingsPanel.setOnUndoStateChange((enabled) => quickActions.setUndoEnabled(enabled))`
  - `applyUiVisibility()` 内で `quickActions.setVisible(uiVisible)` を追加
  - `dispose()` 系で `quickActions.dispose()` を呼ぶ

- [ ] **Step 3: `App.startPose()` 完了後に `QuickActionsBar` を表示**

  - 既存の `showControlPanel()` の代わりに `quickActions.show()` (or constructor で即時表示) する
  - 起動オーバーレイ消滅 → Quick Actions 表示の流れを維持

- [ ] **Step 4: 結合確認**

  ```sh
  bun test
  bun --bun tsc --noEmit
  ```

---

### Task 5: 全テスト & ローカル動作確認

- [ ] `bun test` 259+α 件全件パス
- [ ] `bun --bun tsc --noEmit` エラーなし
- [ ] `bun run dev` でブラウザを開き、以下を目視確認:
  - 開始オーバーレイ → 起動後に画面上部に Quick Actions バーが表示される
  - Random / Undo / Next / Manage / Random preset の各ボタンが期待動作する
  - 音声ソース切替 (file / mic / display) が機能する
  - 右上の音声ソースパネルが**もう存在しない**
  - lil-gui のタブをクリックすると他のタブが閉じる
  - `H` キーで Quick Actions ごと UI が一括非表示になる

---

### Task 6: コミット → push → PR 作成 → コンフリクトチェック → 動作確認依頼

- [ ] feature/34-ui-redesign ブランチに commit (`#34 feat:` プレフィクス)
- [ ] origin に push
- [ ] PR 作成 (`Closes #34` は **書かない**)
- [ ] `git fetch origin main` で最新を取得、競合チェック (なければスキップ)
- [ ] worktree 実パス入りの動作確認 1 行コマンドをユーザに提示
