# ランダム化ボタン 設計・実装計画

対象 Issue: https://github.com/mishi5/three-art/issues/21

## 目的

`SettingsPanel` に「現在の render mode に関連するパラメータのみ」をワンクリックで
一様乱数化するボタンと、直前状態に戻す Undo ボタンを追加する。

## 決定事項（ブラッシュアップで合意済み）

- 対象スコープ: `settings.mode` に関連するパラメータのみ。`mode` 自体は不変。
- 構造系（gridW/H, rain.count, lattice.resolution, preset, particleShape 等）も含めて対象。
- 乱数: GUI スライダの `min..max` から一様乱数（`step` に丸める）。boolean は
  コインフリップ、enum は候補からランダム選択。
- Undo: ランダム化直前の `Settings` スナップショット 1 つを保持して復元。
- 配置: `Preset` フォルダに `randomize (current mode)` / `undo randomize`。
- `auto.*` は制御系のため対象外。

## アーキテクチャ

### 新モジュール `src/pose-particles/ui/randomize.ts`（純粋・テスト可能）

パラメータ記述子の単一リストを定義し、そこから乱数化を行う。

```ts
type RandSpec =
  | { path: string; kind: "number"; min: number; max: number; step: number }
  | { path: string; kind: "boolean" }
  | { path: string; kind: "enum"; options: ReadonlyArray<string> };

interface ParamDescriptor {
  spec: RandSpec;
  /** このパラメータを対象にする RenderMode 群 */
  modes: ReadonlyArray<RenderMode>;
}

export const RANDOMIZE_DESCRIPTORS: ReadonlyArray<ParamDescriptor>;

/** mode に該当する記述子のみで rng を使い settings のコピーを返す（純粋） */
export function randomizeSettings(
  base: Settings, mode: RenderMode, rng: () => number
): Settings;
```

- 数値: `value = clampStep(min + rng()*(max-min), min, max, step)`。step に丸めて
  `[min,max]` にクランプ。
- enum: `options[floor(rng()*options.length)]`。
- boolean: `rng() < 0.5`。
- `image` 制約: `gridW * gridH <= 5200`。乱数後に超過する場合、両者へ
  `sqrt(5200 / (gridW*gridH))` を乗じて step/min に丸めて再クランプ。
- 適用は既存 `automation/setByPath.ts` を再利用。
- `base` はディープコピー（既存 `App` の snapshot パターンと同様の素朴コピー）
  してから書き換え、元オブジェクトは不変に保つ。

### 設計判断: 値域の単一情報源化は今回見送る

lil-gui の `.add(min,max,step)` と記述子で min/max/step が二重管理になる。
GUI を記述子駆動に全面リファクタする案もあるが、ブラウザ自動テストが無い
視覚アプリでブラスト半径が大きく、Issue の範囲を超える。
今回は記述子モジュールを別に持ち、`SettingsPanel` 冒頭コメントで相互参照を
明記。drift 検出のため「全 path が Settings に存在する」ことをテストで保証する
（範囲一致は手動レビュー責務とし plan に明記）。将来 GUI 駆動化する場合の
土台として記述子を単一リスト化しておく。

### mode → パラメータ・マッピング

RENDER_MODES = bones, cube, sphere, lattice, image, rain。

- common（全 mode）: `color.{hueBase,hueSpread,bassHueShift,saturation,trebleBoost}`,
  `fragmentField.{driftBase,midDrift,jointPull,noiseScale,timeSpeed}`,
  `twist.{enabled,axis,strength,bassDrive,phaseSpeed}`,
  `blur.{enabled,strength,iterations,bassDrive}`, `outlier.{fraction,boost}`,
  `camera.autoRotateSpeed`, `audioGain.{volume,bass,mid,treble}`,
  `audioSmoothing`, `motion.{target,strength}`
- bones/cube/sphere/lattice: `pointCloud.{trebleShimmer,ambientShimmer,baseSize,volumeSize}`
- bones のみ: `pointCloud.bassExpansion`, `edges.{enabled,anchorCount,kNeighbors,alpha}`
- cube/sphere のみ: `shape.{radius,bassPulse}`
- lattice のみ: `lattice.{resolution,waveAmplitude}`
- lattice + image: `lattice.{waveSpeed,waveOscFreq,waveDamping,onsetThreshold,onsetCooldown}`
- image のみ: `image.{preset,gridW,gridH,pushAmount,noiseAmp,noiseScale,noiseSpeed,waveStrength,sizeScale,particleShape}`
- rain のみ: `rain.{baseSpeed,ampGain,count,length,areaWidth,areaHeight,binMapping}`

`image.preset` の enum は実プリセット `["sample-01.svg","sample-02.svg"]` のみ
（`"(uploaded)"` は除外）。

### 副作用コールバック

`rain.count` / `binMapping` / `areaWidth` / `areaHeight` は `RainField.update`
が毎フレーム差分検知して自動 rebuild するため追加配線不要（実装で確認済み）。
image のみ明示反映が必要:

- `image.gridW`/`image.gridH` が変化 → `callbacks.onImageRegridRequest?.()`
- `image.preset` が変化 → `callbacks.onImageRequest?.({kind:"preset",path})`

### `SettingsPanel` 変更

- `randomize(): void` — `randomizeSettings` を呼び、戻り値で snapshot を取り
  `deepAssign` で live settings に反映。`controllersRecursive().updateDisplay()`
  と `saveSettings`。image 差分があればコールバック発火。
- Undo 用 `private prevSnapshot: Settings | null`。randomize 実行直前の
  live settings ディープコピーを保持。
- `undoRandomize(): void` — snapshot があれば `deepAssign` で戻し、updateDisplay
  + saveSettings。image 差分時はコールバック発火。snapshot は保持（連打で
  「直前」に戻り続ける = randomize 直前固定）。
- `Preset` フォルダに 2 ボタン追加。Undo は初期 disable、randomize 後 enable。
- Auto モード時: `autoControlled` は randomize しても自動制御に上書きされる旨を
  コメントで明記（仕様として許容）。

## テスト計画（TDD）

`src/pose-particles/ui/randomize.test.ts`:

1. 全 descriptor の `path` が `makeDefaultSettings()` に実在する。
2. mode フィルタ: `image` で `rain.*`/`shape.*` を含まず、`image.*` を含む等を
   代表 mode で検証。`mode` キー自体は不変。
3. 数値が `[min,max]` 内かつ step の整数倍（許容誤差）に収まる（固定 rng）。
4. enum 結果が options のいずれか。boolean が真偽。
5. `rng=()=>0` / `rng=()=>0.999...` の端でも範囲内（クランプ）。
6. image: `gridW*gridH<=5200` が乱数後も常に成立（多シードで反復）。
7. `randomizeSettings` が `base` を破壊しない（元オブジェクト不変）。
8. snapshot/Undo は SettingsPanel 経由（lil-gui は jsdom 不要の範囲のみ。
   GUI 結線はユニット困難なため純粋ロジックに寄せ、Undo 復元は
   `deepAssign` 往復のロジックを randomize.test 内で関数として検証）。

既存 158 テストは不変でパスを維持。

## 作業手順

1. 本ドキュメントコミット。
2. `randomize.test.ts` 先行作成（RED）。
3. `randomize.ts` 実装（GREEN）。
4. `SettingsPanel` 結線。
5. `bun test` 全件パス。型チェック（`tsc --noEmit`）。
6. コミット・プッシュ・PR（main 向け、`Closes` を書かない）。
7. ユーザ動作確認 → OK後 Issue コメント＋クローズ → 後片付け。
