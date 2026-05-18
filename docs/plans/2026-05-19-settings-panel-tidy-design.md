# SettingsPanel パラメータメニュー整理 設計

- Issue: https://github.com/mishi5/three-art/issues/23
- 関連: Issue #18 (https://github.com/mishi5/three-art/issues/18) / PR #20 / Issue #27 (ツールチップ)

## 背景と目的

Issue #18 で各パラメータの効くモードを示すため、SettingsPanel のラベル末尾に
`[lattice+image]` / `[lattice]` / `[速度等は Lattice/Wave]` の注記を付けた結果、
ラベルが長く煩雑になりパネルが見づらい。

加えて Issue #27 でホバーツールチップ (`param-docs.ts`) が追加され、各パラメータの
説明・効果方向・モード適用範囲はツールチップ側に正本がある。ラベル注記は重複。

目的: 効果範囲の伝達を保ちつつ、視覚的にスッキリしたメニュー構成へ整理する。

## 決定事項 (ブレインストーミング結果)

1. **ラベル注記の全廃**: `.name()` から `[...]` モード注記を除去。モード情報は
   ツールチップ + フォルダ構成で担保。
2. **共通含む機能別フォルダ再グループ** (2 段ネスト)。
3. **mode 連動の非活性化**: 現在の `render mode` に無関係なモード専用フォルダ内
   コントローラを `disable()`、関連フォルダを `enable()`。フォルダは畳まず開いた
   まま (disable により自動的に淡色化)。
4. **Auto 連動 disable の廃止**: 既存の `autoControlled` / `applyAutoDisabled` を
   削除。これにより唯一の disable 機構が「mode 連動」になる。
   - 挙動変更点: Auto ON 時に autoControlled スライダが灰色化していたのが無くなる。
     Auto による毎フレーム上書き機能は不変 (視覚ヒントのみ消える)。
   - ※ Issue #23 本来の範囲外だがユーザ判断により本対応に含める。

## 新フォルダ構成

```
render mode                      ← トップレベル維持 (見落とし防止)

▸ Audio        volume / bass / mid / treble / smoothing
▸ Look
    ▸ Color    saturation / hue base / hue spread / bass hue shift / treble brightness
    ▸ Outliers fraction / spike amplitude
▸ Particles
    ▸ PointCloud    bass expansion / treble shimmer / ambient shimmer / base size / volume size
    ▸ FragmentField drift base / mid drift / joint pull / noise scale / noise speed
    ▸ Edges         enabled / anchor count / k neighbours / opacity
▸ Mode                           ← モード専用ゾーン (mode 連動 disable 対象)
    ▸ Shape    (cube/sphere)   radius / bass pulse
    ▸ Wave     (lattice/image) wave speed / osc freq / damping / onset threshold / onset cooldown
    ▸ Lattice  (lattice)       resolution / wave amplitude
    ▸ Image    (image)         preset / upload / grid W/H / size scale / shape / Z push / noise* / wave strength
    ▸ Rain     (rain)          base speed / amp gain / count / length / area W/H / bin mapping
▸ Post-process
    ▸ Twist    enabled / axis / strength / bass drive / phase speed
    ▸ Blur     enabled / strength / iterations / bass drive
▸ System
    ▸ Camera   auto rotate
    ▸ Motion   target param / strength
    ▸ Auto     enabled / transition / sensitivity / min section / style blend / Re-analyze
    ▸ Preset   reset / export / import / randomize / undo
```

### 既存「Lattice / Wave」フォルダの分割

| 新サブフォルダ | パラメータ | 関連 mode |
|---|---|---|
| `Wave` | waveSpeed, waveOscFreq, waveDamping, onsetThreshold, onsetCooldown | lattice, image |
| `Lattice` | resolution, waveAmplitude | lattice |

`image.waveStrength` は image 専用のため Image サブフォルダに残置 (ラベル注記のみ除去)。

## mode → 通常表示になる Mode ゾーンサブフォルダ

| mode | active なサブフォルダ |
|---|---|
| bones | (なし — 全 5 サブフォルダ disable) |
| cube | Shape |
| sphere | Shape |
| lattice | Wave, Lattice |
| image | Wave, Image |
| rain | Rain |

純粋関数として切り出す:

```ts
// src/pose-particles/ui/mode-folders.ts
export type ModeFolderKey = "shape" | "wave" | "lattice" | "image" | "rain";
export function activeModeFolders(mode: RenderMode): ReadonlySet<ModeFolderKey>;
```

`SettingsPanel` は Mode ゾーンの 5 サブフォルダを `ModeFolderKey` で保持し、
mode 変更時に `activeModeFolders(mode)` の結果で各サブフォルダ配下コントローラを
`enable()/disable()` する `applyModeActivation(mode)` を持つ。

## mode 変更を検知すべき経路

`applyModeActivation` を呼ぶ箇所:

- `render mode` dropdown の `onChange`
- `applyPreset` (reset / import YAML) 後
- `randomize` / `undoRandomize` 後 (mode は randomize 対象外だが preset import 経由で
  変わりうるため一律で再評価)

初期化時にも `applyModeActivation(settings.mode)` を 1 回呼ぶ。

## 技術確認 (影響なしを確認済み)

- ツールチップ `attachParamTooltips` は `controllersRecursive()` 走査のため
  2 段ネストでも全コントローラに付与される。
- `resolveDocKey(settings, controller.object, controller.property)` は
  `.object`(= `settings.color` 等) ベースでフォルダ構成に非依存。doc キー解決は不変。
- `applyPreset` / `randomize` の `gui.controllersRecursive().forEach(updateDisplay)`
  もネスト非依存。

## テスト戦略

SettingsPanel 自体は lil-gui DOM 依存でユニットテスト困難なため、ロジックを純粋
関数に切り出してテストする。

1. **`mode-folders.test.ts`** (新規): `activeModeFolders(mode)` の全 6 mode の
   期待集合を検査。
2. **`param-docs.test.ts`** (既存): `makeDefaultSettings()` の全 leaf が
   `PARAM_DOCS` 網羅 — フォルダ再編で leaf パスは不変なので影響なし (回帰確認)。
3. **`settings.test.ts`** / 既存全 186 件: 全件パス維持。Auto disable 廃止は
   `settings.ts` の構造に触れないためテスト変更は不要の見込み (要確認)。

## 受け入れ基準 (Issue #23)

- パラメータの効果範囲がユーザに伝わる → ツールチップ + Mode ゾーン構成 +
  mode 連動 disable で担保。
- 既存テスト全件パス。
- 既存モード (bones/cube/sphere/lattice/image/rain) の挙動に regression なし →
  手動動作確認 (各モード切替で粒子描画・音声反応が従来通り)。

## スコープ外

- 共通フォルダ内パラメータの値域・デフォルト変更はしない (並び替えと
  グルーピングのみ)。
- Auto モードの自動制御ロジック自体は変更しない (disable の視覚ヒント廃止のみ)。
