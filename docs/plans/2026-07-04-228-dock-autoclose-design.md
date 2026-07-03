# #228 サイドドックの自動クローズ＋ピン留め 設計

Issue: https://github.com/mishi5/three-art/issues/228

## 目的

左サイドドック（`buildSideDock`）のパネルを、**非アクティブ時（パネル外の pointerdown）に自動で閉じる**挙動へ変更する。
あわせて**ピン留めトグル**をパネルヘッダに追加し、ピン中は従来どおり手動で閉じるまで開いたままにできる。
ピン状態は #229 の汎用 prefs（localStorage `node-vj.prefs.v1`）に永続化する。

## 仕様

- 既定（非ピン）: パネルが開いている状態でパネル外（キャンバス等）を pointerdown すると `setActive(null)` で閉じる。
- アクティビティバー（bar）内・パネル（pane）内の pointerdown では閉じない
  （bar のアイコンはトグル動作に委ね、pane 内の操作＝アセット/シーンのボタン等で誤クローズしない）。
- ピン中は外側 pointerdown を無視（自動クローズしない）。
- アイコン再クリック・折りたたみボタンでの開閉は従来どおり。
- ピン状態は prefs の `dockPinned: boolean`（既定 false）で永続化し、再読込後も保持。

## 実装

### 1. prefs（`src/apps/node-vj/prefs.ts`）

#229 のコメントどおり、フィールド追加は 3 行:

- `Prefs` に `dockPinned: boolean` を追加
- `DEFAULT_PREFS` に `dockPinned: false`
- `parsePrefs` に `if (typeof src.dockPinned === "boolean") prefs.dockPinned = src.dockPinned;`

### 2. 開閉判定の純関数（`editor/side-dock.ts`）

```ts
export interface AutoCloseInput {
  pinned: boolean;       // ピン留め中か
  paneOpen: boolean;     // パネルが開いているか
  targetInBar: boolean;  // pointerdown 対象がアクティビティバー内か
  targetInPane: boolean; // pointerdown 対象がパネル内か
}
export function shouldAutoClose(input: AutoCloseInput): boolean;
// paneOpen && !pinned && !targetInBar && !targetInPane
```

### 3. `buildSideDock` の変更

- 第 2 引数に永続化アクション（settings-panel の actions パターンに合わせる）:

```ts
export interface DockPinActions {
  getPinned(): boolean;      // 初期値の復元
  setPinned(v: boolean): void; // トグル時の保存
}
export function buildSideDock(panels: SidePanelDef[], pin: DockPinActions): void;
```

- ヘッダに折りたたみボタンの左隣としてピンボタンを追加（トグル）。
  ON 時は背景 `#243042`・文字色 `#cfe` でハイライト（アクティビティボタンと同じ表現）。
  title は状態に応じて「ピン留め（外側クリックで閉じない）」/「ピン解除」。
- `document` へ `pointerdown`（capture）リスナーを登録し、
  `shouldAutoClose({ pinned, paneOpen: active !== null, targetInBar: bar.contains(t), targetInPane: pane.contains(t) })`
  が真なら `setActive(null)`。`NodeEditor.closeOnOutside`（#166）と同種のパターン。

### 4. main.ts の配線

```ts
buildSideDock([...], {
  getPinned: () => prefsStore.load().dockPinned,
  setPinned: (v) => prefsStore.save({ dockPinned: v }),
});
```

## テスト（TDD）

- `prefs.test.ts`: `dockPinned` の既定値 false / true 読み取り / 不正値フォールバック /
  save→load の永続化 / panMode との独立性（部分更新）。
- `side-dock.test.ts`: `shouldAutoClose` の全分岐
  （外側で閉じる・pinned で閉じない・bar/pane 内で閉じない・pane 閉時は何もしない）。

DOM 統合（ピンボタン・実イベント）は手動 / Playwright 確認とする（既存の side-dock と同方針）。

## 手動確認項目

1. パネルを開いてキャンバスをクリック → 閉じる
2. ピン ON でキャンバスをクリック → 閉じない
3. ピン ON のまま再読込 → ピン状態が復元される（外側クリックで閉じない）
4. パネル内のボタン操作で閉じない / アイコン再クリック・折りたたみボタンは従来どおり
