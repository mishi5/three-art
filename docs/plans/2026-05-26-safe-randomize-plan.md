# Safe Randomize ボタン 設計・実装計画

対象 Issue: https://github.com/mishi5/three-art/issues/46

## 目的

既存 `🎲 randomize` の隣に、**除外 path を選べる `🎲 safe-rand`** を追加する。
`camera.autoRotateSpeed` と `blur.*` (4 path) を初期除外にして、視覚への影響が
大きいパラメータを保持したままランダム化できるようにする。

## 決定事項 (Issue ブレストで合意済み)

- 除外リストは **GUI checkbox** で管理 (path 単位)
- UI 配置は **`QuickActionsBar` の `🎲 safe-rand` 隣の `⚙` ポップオーバー**
- 既存 `🎲 randomize` は据え置き、`🎲 safe-rand` は **並立**
- デフォルト除外: `camera.autoRotateSpeed`, `blur.enabled`, `blur.strength`,
  `blur.iterations`, `blur.bassDrive`
- 永続化: `localStorage` (settings 本体とは別キー)
- 全 mode の descriptor path を常時表示 (現 mode 非該当はグレー表示)

## アーキテクチャ

### モジュール構成

```
src/pose-particles/ui/
├── randomize.ts              (拡張: randomizeSettings に excludedPaths 引数追加)
├── safe-randomize-storage.ts (新規: localStorage の load/save)
├── SafeRandomizePopover.ts   (新規: checkbox UI クラス)
├── QuickActionsBar.ts        (拡張: safe-rand / ⚙ ボタン追加 + callback)
├── SettingsPanel.ts          (拡張: safeRandomize() メソッド追加)
└── tests (新規 / 拡張)
```

### `randomize.ts` の変更

既存 `randomizeSettings(base, mode, rng?)` を最小破壊で拡張する。
**シグネチャに 4 番目のオプション引数 `excludedPaths` を追加**:

```ts
export function randomizeSettings(
  base: Settings,
  mode: RenderMode,
  rng: () => number = Math.random,
  excludedPaths: ReadonlySet<string> = new Set(),
): Settings;
```

`excludedPaths` に含まれる path はループでスキップする
(`setByPath` を呼ばないので、`base` の値がそのまま `out` に残る)。
既存呼出 (`SettingsPanel.randomize`) は 4 番目を渡さないので空集合 = 従来通り。

専用 wrapper を別途公開:

```ts
export function safeRandomizeSettings(
  base: Settings,
  mode: RenderMode,
  excludedPaths: ReadonlySet<string>,
  rng: () => number = Math.random,
): Settings;
```

実体は `randomizeSettings(base, mode, rng, excludedPaths)` の呼び出し。
**呼出箇所での意図表明**用に名前を分けるだけ。
- `randomizeSettings`: 全部入り
- `safeRandomizeSettings`: 除外あり

デフォルト除外定数も export:

```ts
export const DEFAULT_SAFE_EXCLUDED: ReadonlyArray<string> = [
  "camera.autoRotateSpeed",
  "blur.enabled",
  "blur.strength",
  "blur.iterations",
  "blur.bassDrive",
];
```

### `safe-randomize-storage.ts` (新規)

`settings.ts` の `STORAGE_KEY / load / save / clear` パターンを踏襲。

```ts
const STORAGE_KEY = "pose-particles.safe-randomize-excluded.v1";

/** localStorage から除外 path 集合を読み出す。未保存なら DEFAULT。 */
export function loadExcludedPaths(): Set<string>;

/** Set を JSON 配列にして書き出す。 */
export function saveExcludedPaths(paths: ReadonlySet<string>): void;
```

仕様:
- `loadExcludedPaths`: storage 値が文字列配列でなければ DEFAULT_SAFE_EXCLUDED にフォールバック
- 「未知の path」(将来 descriptor から削除された path) も load 時にそのまま保持
  → safeRandomize 実行時は **既存 descriptor との交差** だけが意味を持つので
  noise にはならない。明示的に filter する必要なし。

### `SafeRandomizePopover.ts` (新規)

`QuickActionsBar` の `⚙` ボタンから開閉される DOM クラス。

```ts
export interface SafeRandomizePopoverCallbacks {
  /** チェック状態が変わるたびに呼ぶ (UI → 永続化への通知)。 */
  onChange: (excluded: ReadonlySet<string>) => void;
}

export class SafeRandomizePopover {
  constructor(initial: ReadonlySet<string>, callbacks: SafeRandomizePopoverCallbacks);
  /** anchor 要素の下に位置決めして表示 */
  show(anchor: HTMLElement): void;
  hide(): void;
  isOpen(): boolean;
  /** popover が今アクティブなら toggle、closed なら show */
  toggle(anchor: HTMLElement): void;
  dispose(): void;
}
```

DOM 構造:
```
[data-role="safe-rand-popover"]
  header: title="Safe Randomize 除外 path"
  scrollable list:
    group "camera"
      header: checkbox + label "camera"
      row: checkbox + label "autoRotateSpeed"
    group "blur"
      ...
  footer: "閉じる"
```

挙動:
- top-level prefix (`path.split(".")[0]`) でグループ化、prefix 昇順
- group header の checkbox はそのグループの状態を 3 状態反映
  (all-on, all-off, indeterminate)
- group header クリックで子 checkbox を all-on / all-off にトグル
- 子 checkbox の変更で `callbacks.onChange(currentSet)` を呼ぶ
- ポップオーバー外クリックで close (mousedown listener、anchor 内クリックは除外)
- `Esc` キー押下で close
- `RANDOMIZE_DESCRIPTORS` の path をそのまま列挙
  (現状 mode で効くかどうかは popover 内では区別しない: シンプル化)

### `QuickActionsBar.ts` の変更

`onRandomize` の隣に **3 ボタン**を追加:

```
[🎲 randomize] [🎲 safe-rand] [⚙] [↶ undo]
```

`QuickActionsCallbacks` 拡張:

```ts
export interface QuickActionsCallbacks {
  onRandomize: () => void;        // 既存
  onSafeRandomize: () => void;    // 新規
  onToggleSafeConfig: () => void; // 新規 (⚙ クリック)
  onUndoRandomize: () => void;    // 既存
  ...
}
```

`makeButton("🎲 safe-rand", "safe-randomize", callbacks.onSafeRandomize)`
`makeButton("⚙", "safe-randomize-config", callbacks.onToggleSafeConfig)`

`getSafeConfigAnchor()`: popover の anchor として ⚙ ボタンの DOM 参照を返す
public メソッドを追加 (popover を `QuickActionsBar` の外で生成して
`toggle(anchor)` する設計のため)。

### `SettingsPanel.ts` の変更

`randomize()` と対になる `safeRandomize(excludedPaths)` を追加:

```ts
safeRandomize(excludedPaths: ReadonlySet<string>): void {
  const before = structuredClone(this.settings) as Settings;
  const next = safeRandomizeSettings(this.settings, this.settings.mode, excludedPaths);
  this.prevSnapshot = before;
  deepAssign(...);
  this.gui.controllersRecursive().forEach((c) => c.updateDisplay());
  this.applyActivation();
  saveSettings(this.settings);
  this.applyImageSideEffects(before, this.settings);
  this.onUndoStateChange?.(true);
}
```

`prevSnapshot` を randomize と共有することで undo は 1 経路で OK
(safe-rand 後 → undo で safe-rand 直前へ、通常 randomize 後 → undo で randomize 直前へ)。

### `App.ts` の配線

```ts
// 1. popover 用の除外 path Set を保持する mutable な state
let excluded = loadExcludedPaths();

// 2. popover を生成
const popover = new SafeRandomizePopover(excluded, {
  onChange: (next) => {
    excluded = new Set(next);
    saveExcludedPaths(excluded);
  },
});

// 3. QuickActionsBar callback
new QuickActionsBar({
  ...
  onSafeRandomize: () => this.settingsPanel.safeRandomize(excluded),
  onToggleSafeConfig: () => popover.toggle(this.quickActions.getSafeConfigAnchor()),
  ...
});
```

dispose 時 popover も dispose。

## テスト計画 (TDD)

新規 / 拡張テストファイル:

1. `randomize.test.ts` (拡張)
   - `excludedPaths` を渡すと、その path だけ `base` の値が保持される
   - `excludedPaths` 空集合 = 既存 `randomizeSettings` と同等
   - `safeRandomizeSettings` は `randomizeSettings(..., excludedPaths)` と等価
   - `DEFAULT_SAFE_EXCLUDED` に camera/blur 全 5 path が含まれる

2. `safe-randomize-storage.test.ts` (新規)
   - 未保存 = DEFAULT_SAFE_EXCLUDED
   - save → load で復元される
   - 不正 JSON / 文字列配列でない → DEFAULT にフォールバック
   - 未知 path を含んだ保存値もそのまま load される

3. `SafeRandomizePopover.test.ts` (新規)
   - 初期表示で initial の path だけ checkbox が ON
   - checkbox トグルで `onChange` が呼ばれる
   - group header checkbox でグループ一括 ON/OFF
   - `show()` 後に外部クリックで自動で hide
   - `Esc` で hide
   - `hide()` / `dispose()` で DOM から消える
   - 全 descriptor path が DOM に存在する (path 数 == checkbox 数)

4. `QuickActionsBar.test.ts` (拡張)
   - `safe-randomize` ボタン存在 → click で `onSafeRandomize` 呼出
   - `safe-randomize-config` ボタン存在 → click で `onToggleSafeConfig` 呼出
   - `getSafeConfigAnchor()` が ⚙ ボタンを返す

5. `SettingsPanel.test.ts` (拡張)
   - `safeRandomize(excluded)` 呼出後 `canUndoRandomize() = true`
   - `safeRandomize` 後 → undo で復元
   - `excluded` の path は値が変わらない (`camera.autoRotateSpeed` 等で確認)
   - `setOnUndoStateChange(cb)` が `safeRandomize` でも呼ばれる

## エッジケース

- 全 path 除外 → safe-rand は実質 no-op だが prevSnapshot は更新される
  (これで OK: ユーザの意図通り。undo すれば元に戻る)
- 除外集合に存在しない path (古い保存値) → スキップロジックは set lookup
  なので影響なし
- popover open 中に画面リサイズ → 簡単のため自動再配置はしない (次の open で
  最新 anchor 位置を使う)

## 受け入れ条件 (Issue より転記)

- [ ] `🎲 safe-rand` ボタンが `QuickActionsBar` に表示される
- [ ] `⚙` でポップオーバーが開き、全 descriptor path が checkbox で並ぶ
- [ ] デフォルトで camera.autoRotateSpeed と blur.* 4 path が ON
- [ ] 除外リストは localStorage に保存され再起動後も復元される
- [ ] `safe-rand` 実行で除外 path の値が変わらず、それ以外が乱数化されることを test で保証
- [ ] 通常 `🎲 randomize` の挙動は変更されない (既存テスト全件パス)
- [ ] `↶ undo` が safe-rand / 通常どちらの直後でも有効に動く

## 実装ステップ

1. `randomize.ts` 拡張 (excludedPaths 引数 + safeRandomizeSettings + DEFAULT) + テスト
2. `safe-randomize-storage.ts` + テスト
3. `SafeRandomizePopover.ts` + テスト
4. `QuickActionsBar.ts` ボタン 2 個追加 + テスト
5. `SettingsPanel.ts` `safeRandomize` メソッド + テスト
6. `App.ts` 配線
7. 全テストパス、ブラウザで動作確認
