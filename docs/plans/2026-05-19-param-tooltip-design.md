# パラメータ説明ツールチップ機能 設計

対象 Issue: https://github.com/mishi5/three-art/issues/27

## 目的

lil-gui の各パラメータにマウスホバーすると、そのパラメータが「何か」「上げ
下げすると見た目がどう変わるか（効果方向）」をツールチップで表示する。レンダ
リング画面を覆わずに、画面を見ながらパラメータ調整できる状態にする。

## 方針（ブレスト確定事項）

- 表示形式: **ホバーツールチップ**
- データ管理: **専用定義マップ**（`src/pose-particles/ui/param-docs.ts`）に
  ドット記法パスをキーに一元管理（既存 `automation/AutomationMap` と同じ
  `color.hueBase` 形式）
- 範囲: **GUI に出る全パラメータ**、各説明に効果方向を含める

## コンポーネント

### `ui/param-docs.ts`

- `interface ParamDoc { summary: string; effect: string }`
  - `summary`: そのパラメータが何か
  - `effect`: 上げる / 下げると見た目がどう変わるか
- `const PARAM_DOCS: Record<string, ParamDoc>`：ドット記法パスをキー
- `settingsLeafPaths(obj): string[]`：設定オブジェクトの leaf パスを再帰列挙
  （欠落検知テスト用）
- `resolveDocKey(settings, object, property): string | null`：lil-gui
  Controller の `.object` / `.property` から doc キーを解決。settings 直下の
  スカラは `property`、ネストは `<group>.<property>`。settings 配下でない
  オブジェクト（reset/randomize 等のアクションボタン）は `null`

### `ui/param-tooltip.ts`

- `attachParamTooltips(gui, settings): void`
  - 単一の共有ツールチップ DOM を `document.body` に固定配置
  - `gui.controllersRecursive()` を走査し、各 controller に
    `mouseenter` / `mouseleave` を付与
  - doc がある → ホバーで `summary` / `effect` を表示
  - doc キーが解決でき doc が無い → `console.warn`（GUI 追加時のドリフト検知）
  - doc キーが `null`（アクションボタン）→ 何もしない
- `computeTooltipPosition(anchorRect, tipSize, viewport): { left; top }`
  - GUI パネルは画面右端にあるため、ツールチップは controller の **左側** に
    出してパネル / 画面を覆わない。画面外にはみ出す場合はクランプ
  - 純粋関数として切り出し、ユニットテスト対象にする

### `ui/SettingsPanel.ts`

- コンストラクタ末尾（GUI 構築完了後）で `attachParamTooltips(this.gui,
  settings)` を呼ぶ

## テスト（TDD）

`ui/param-docs.test.ts`

1. `makeDefaultSettings()` の全 leaf パスが `PARAM_DOCS` に存在する（欠落検知）
2. 各 `ParamDoc` の `summary` / `effect` が非空
3. `resolveDocKey`：
   - settings 直下スカラ（`mode`）→ `"mode"`
   - ネスト（`settings.pointCloud` + `bassExpansion`）→
     `"pointCloud.bassExpansion"`
   - settings 外オブジェクト → `null`

`ui/param-tooltip.test.ts`

4. `computeTooltipPosition` がアンカー左側に配置し、ビューポート外に
   はみ出さないようクランプする

DOM イベント配線（mouseenter 等）は bun:test に DOM が無いため自動テスト対象
外。ユーザの手動動作確認で担保する。

## 受け入れ条件との対応

| Issue 受け入れ条件 | 対応 |
| --- | --- |
| 全 GUI パラメータにホバーで説明 | 全 leaf パス網羅をテスト 1 で保証 + 配線 |
| 説明に効果方向 | `ParamDoc.effect` 必須、テスト 2 |
| 説明欠落を検知 | テスト 1（CI） + 実行時 `console.warn` |
| 表示中も画面が見える | 右端 GUI の左側に配置、テスト 4 |
