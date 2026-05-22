# UI 配置再設計 Design

Issue: https://github.com/mishi5/three-art/issues/34

## 課題

機能追加を重ねた結果、画面右側 `lil-gui` (SettingsPanel) の最下部 `System > Preset` フォルダに頻用ボタンが 8 個連なっており、UX 上の以下の問題がある:

- **スクロールが長い**: lil-gui の縦長メニューの一番下に主要ボタン (`randomize` / `next preset` / `manage…`) があり、毎回スクロールが必要
- **ボタン間隔が狭い**: lil-gui のリストアイテム高さ (24px 前後) が密接していて、隣接ボタンの誤タップが発生しやすい
- **グルーピング不足**: 同じ「Preset」フォルダに性質の異なる操作 (破壊的な reset / 入出力 / ランダム / 一覧管理 / 切替) が並んでおり、どれが何をするかパッと分からない
- **UI の散らばり**: 音声ソース選択 (右上独立パネル) / lil-gui (右側) / Section Timeline (下端) / Debug overlay (左下) と四方にバラけている

## 解決方針: Quick Actions バー新設 + lil-gui タブ化

### 1. 画面上部に `QuickActionsBar` を新設

頻用操作を独立した横長バーに集約する。

**含めるボタン (頻用順):**

| グループ | ボタン | 既存呼び出し先 |
| --- | --- | --- |
| Preset 選択 | `manage…` / `next ▶` / `random` | `App.ts` 内 `onOpenPresetManager` / `onNextPreset` / `onRandomPreset` |
| ランダム | `randomize` / `undo` | `SettingsPanel.randomize()` / `undoRandomize()` (現状 private) |
| 音声ソース | `file` / `mic` / `display` | 現 `UI.ts showControlPanel` 内ハンドラ |

**配置:** 画面上部 (`top: 16px`)、`position: fixed`、横一本。中央を空け、左寄せ (Preset+Randomize) と右寄せ (音声ソース) の 2 ブロック構成にして作品ビューを遮らない。

**スタイル:**
- ボタン最小高 32px、相互間隔 ≥ 8px
- グループ間に 16px のセパレータ
- 半透明背景 `rgba(20,20,20,0.7)` + `backdrop-filter: blur(4px)` (lil-gui と同調)
- `z-index: 55` で lil-gui と同レベル、Section Timeline (50) より上

**音声ソースの表示状態:** 現在の `showControlPanel` は file 選択時のファイル入力、mic/display のステータスを表示している。これらは Quick Actions バーの直下にコンパクトに表示する (file 選択時のみファイル input を展開、再生中はファイル名を小さく表示)。

### 2. lil-gui から Preset 系ボタンを除去

`SettingsPanel.ts` の `System > Preset` フォルダから以下 5 ボタンを削除する:

- `randomize (current mode)`
- `undo randomize`
- `manage presets…`
- `next preset ▶`
- `random preset`

`Preset` フォルダに残すのは:
- `reset to defaults` (破壊的、低頻度)
- `export preset (.yaml)` (低頻度)
- `import preset (.yaml)` (低頻度)

### 3. lil-gui のトップレベルフォルダをタブ化

lil-gui は native でタブをサポートしない。`SettingsPanel` の `gui.domElement` 直上に独自のタブバー DOM を挿入し、タブクリックで `Folder.open()` / `Folder.close()` を排他制御する。

**タブ:** `Audio` / `Look` / `Particles` / `Mode` / `Post` / `System`

**初期状態:** `Audio` タブ選択 (現状の最初のフォルダに合わせる)

**実装:**
- `SettingsPanel.ts` に `private buildTabBar(): HTMLDivElement` を追加
- 各タブボタンのクリックで該当トップレベルフォルダ以外を `close()`、該当のみ `open()`
- アクティブタブを CSS class `.qa-tab-active` で示す
- `Folder.open/close` の現在状態を読み取り、初回も同期する

### 4. 右上の音声ソースパネルを廃止 / 統合

`UI.ts` の `showControlPanel` メソッドを廃止し、責務を `QuickActionsBar` と `App` 間の wiring に移譲する。`UI.ts` は `showStartOverlay` のみを担当するシンプルなクラスに残す。

## アーキテクチャ

```
┌──────────────────────────────────────────────┐
│ App (constructor)                            │
│  ├── SettingsPanel                           │
│  ├── PresetManagerPanel                      │
│  ├── SectionTimeline                         │
│  ├── DebugOverlay                            │
│  └── QuickActionsBar (new)                   │
│        ↑                                     │
│        │ callbacks                           │
│   ┌────┴────┐                                │
│   │ onRandomize, onUndoRandomize             │
│   │ onOpenPresetManager, onNextPreset, ...   │
│   │ onSelectAudioSource(kind)                │
│   └─────────┘                                │
└──────────────────────────────────────────────┘
```

### 公開 API 設計

```ts
// QuickActionsBar.ts
export interface QuickActionsCallbacks {
  onRandomize: () => void;
  onUndoRandomize: () => void;
  onOpenPresetManager: () => void;
  onNextPreset: () => void;
  onRandomPreset: () => void;
  onSelectAudioSource: (kind: "file" | "mic" | "display", file?: File) => Promise<void> | void;
}

export class QuickActionsBar {
  constructor(callbacks: QuickActionsCallbacks);
  setUndoEnabled(enabled: boolean): void;
  setVisible(visible: boolean): void;
  setAudioStatus(text: string, isError?: boolean): void;
  dispose(): void;
}
```

- `setUndoEnabled`: `randomize` 直後に有効化 / `undo` 後に無効化。`SettingsPanel` の `undoController` の状態と同期。
- `setAudioStatus`: file 名表示や「マイク使用中」「PC音声 使用中」、エラーメッセージを共通表示エリアに出す。
- `setVisible`: `H` キー押下時の UI 一括非表示と連動。

### SettingsPanel 改修

```ts
// SettingsPanel public API 追加
export class SettingsPanel {
  // 既存のまま
  applyPreset(next: Settings, opts?: { clearStorage?: boolean }): void;

  // 追加: QuickActionsBar から呼ぶための公開化
  randomize(): void;          // 既存 private を public 化
  undoRandomize(): void;      // 既存 private を public 化
  canUndoRandomize(): boolean;
  setOnUndoStateChange(cb: (enabled: boolean) => void): void;
}
```

`SettingsPanel.randomize()` 呼出時に外部リスナへ `enabled = true` を通知、`undoRandomize()` 後に `enabled = false` を通知する。これにより `QuickActionsBar.setUndoEnabled` が同期する。

### タブ排他制御

```ts
// SettingsPanel 内
private topFolders: { name: string; folder: GUI }[];
private tabBar: HTMLDivElement;

private switchTab(active: string): void {
  for (const { name, folder } of this.topFolders) {
    if (name === active) folder.open();
    else folder.close();
  }
  this.updateTabActiveStyle(active);
}
```

タブクリック以外で folder が手動展開された場合は、その folder のタイトル click に listener を挟んで「クリックで他を閉じる」挙動に統一する (任意ステップ; native 折り畳みも許容する設計にしても良い)。

## テスト計画

### 新規テスト

**`QuickActionsBar.test.ts`** (DOM 構造 / コールバック発火):
- 構築時に Preset 系 3 ボタン、Randomize 系 2 ボタン、音声ソース 3 ボタン (or dropdown) が DOM 上に存在する
- 各ボタンクリックで対応コールバックが呼ばれる
- `setUndoEnabled(false)` 後に undo ボタンが disabled になる
- `setAudioStatus("text")` でステータスエリアにテキストが反映される
- `dispose()` で DOM から除去される

**`SettingsPanel.test.ts` 拡張** (タブ排他切替):
- 初期状態で `Audio` フォルダが open、他は close
- `switchTab("Look")` で `Look` のみ open、`Audio` 含む他が close
- `Preset` フォルダから randomize / undo / manage / next / random の controller が存在しない (controller 名で検査)
- `reset` / `export` / `import` は引き続き存在

### 既存テスト

- `randomize.test.ts` は `SettingsPanel` を介さず `randomizeSettings` をテストしているので影響なし
- `preset-yaml.test.ts` は import/export ロジックのみ
- 既存テスト 259 件全件パスを維持

## YAGNI / スコープ外

- ドラッグ移動可能なフローティングバー (将来必要なら別 Issue)
- 完全独自 UI (lil-gui 廃止) への置き換え (今回はやらない)
- Quick Actions のキーボードショートカット (`R` で randomize 等) は将来 Issue
- 音声ソースを dropdown 化するか 3 つのボタンにするかは「3 ボタン」で確定 (現状 UX 維持)

## 関連 Issue

- #23 (lil-gui パラメータ整理) — 同じ SettingsPanel を触る。本タスクは #23 の後継位置づけ
- #26 (Preset Manager) — `PresetManagerPanel` 呼出を Quick Actions から行う
- #21 (randomize ボタン) — `randomize` / `undo` を Quick Actions に再配置
