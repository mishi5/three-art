# pose-particles: 曲解析 Auto モード — 設計

- 対象 Issue: https://github.com/mishi5/three-art/issues/5
- 対象作品: pose-particles
- ブランチ: `feature/5-song-auto-mode`
- 日付: 2026-05-04

## 概要

曲ファイルを再生前に事前解析し、曲を「セクション」（盛り上がり方や帯域の傾向が変わる
区間）に分割し、各セクションの特徴量から作品の主要パラメータ（色相・粒子膨張・shimmer・
ブラー強度・自動回転速度など 10 種）を線形重み式で自動算出して上書きする「Auto モード」
を追加する。

セクション内では算出された "ベース値" の上に既存のフレーム単位の audio reactive
ロジック（`bassExpansion` などの shader 内応答）がそのまま乗る。境界を跨いだ前後
`transitionSec/2` の窓では特徴量を `smoothstep` で線形補間して急変を避ける。

対象音源は曲ファイル（`FileAudioSource`）のみ。マイク（`MicAudioSource`）は対象外で、
auto 有効時にマイクが選ばれていれば UI で通知してスキップする。

境界はユーザが画面下部のタイムライン上でクリック追加・削除できる。

## 要件と設計判断（ブレスト確定事項）

| 論点 | 採用 |
|---|---|
| スコープ | A. 曲ファイル専用・事前解析（OfflineAudioContext） |
| 算出方式 | 個別パラメータをセクション特徴量から関数で算出（プリセット案は不採用） |
| 自動モード時の手動 slider | 無効化（disable） |
| 特徴量の正規化 | C. ハイブリッド（盛り上がり量は曲内 min-max 正規化、帯域は絶対値） |
| 対象パラメータ範囲 | C. 主要 10 個から始めマップ拡張可能な構造 |
| 境界検出 UI | C. 閾値スライダ + 波形/エネルギー曲線可視化 + クリック編集 |
| セクション内の値挙動 | B. セクション特徴量 = ベース値、フレーム毎 audio reactive はその上に乗る |
| 解析結果の保存 | C. ファイルハッシュキーで localStorage キャッシュ + 「Re-analyze」ボタン |
| 算出関数の形式 | A. 線形重み（`base + we*energyNorm + wb*bassAbs + wm*midAbs + wt*trebleAbs` を clamp） |

## 設計

### ファイル構成

追加:

- `src/pose-particles/audio/SongAnalyzer.ts`
  - `OfflineAudioContext` で `AudioBuffer` 全体を走査し、ホップ間隔
    (約 50ms = 20fps) ごとに帯域別エネルギーを `BandFrame` として蓄積する。
  - 帯域計算は既存 `audio/AudioAnalyzer.ts` の `computeBands()` を共有
    （リアルタイムとオフラインで式を一致させる）。
- `src/pose-particles/audio/SongAnalyzer.test.ts`
  - 純粋関数化したフレーム蓄積部分の単体テスト。`OfflineAudioContext`
    そのものは Bun テストランタイムでは動かないため、結合は手動確認。
- `src/pose-particles/audio/SectionDetector.ts`
  - 帯域時系列から spectral novelty (隣接フレーム 3 帯域ベクトルのコサイン
    距離) を計算 → 1 秒移動平均で平滑化 → ピーク検出 →
    `noveltyThreshold` を超えたら境界候補。`minSectionSec` 未満の連続境界
    はマージする。境界配列が決まったら、各セクションの
    `energyNorm` (曲全体の volume の min/max を取り min-max 正規化) と
    `bassAbs / midAbs / trebleAbs` (セクション内平均、生値) を計算する。
- `src/pose-particles/audio/SectionDetector.test.ts`
  - 合成 `BandTimeSeries`（前半 bass-only / 後半 treble-only など）に対して
    境界が中央付近に立つこと、`noveltyThreshold` を上げると境界数が減ること、
    `minSectionSec` で過剰検出が抑制されること、セクション特徴量が期待値で
    あることを検証。
- `src/pose-particles/automation/setByPath.ts`
  - `"color.hueBase"` のようなドット記法で `Settings` の階層に値を書き込む
    純粋ユーティリティ。
- `src/pose-particles/automation/AutomationMap.ts`
  - `AutomationEntry` 型と `DEFAULT_AUTOMATION_MAP`（10 行のテーブル）を
    エクスポート。`computeValue(entry, features)` 純粋関数も提供。
- `src/pose-particles/automation/AutomationMap.test.ts`
  - `computeValue` が `clamp(base + Σwi*xi, min, max)` どおりに動くこと、
    `DEFAULT_AUTOMATION_MAP` が `energyNorm=0` かつ全帯域 0 のとき `base`
    と一致することを検証。
- `src/pose-particles/automation/ParameterAutomation.ts`
  - セクション配列・境界配列・マップ・transitionSec を保持し、
    `applyAt(t, live)` で再生時刻 `t` の特徴量（境界 ±transitionSec/2 の窓内
    では前後セクションを smoothstep で補間）から各 `target` を計算し、
    `setByPath(live, target, value)` で書き込む。
- `src/pose-particles/automation/ParameterAutomation.test.ts`
  - 境界中央点では補間がかからず純粋に式どおりに値が出ること、
    境界 ±transitionSec/2 の窓内で smoothstep 補間が効くこと、
    `setByPath` が `color.hueBase` / `blur.strength` 等の階層に正しく書き込む
    こと、`clamp(min, max)` が両端で機能することを検証。
- `src/pose-particles/automation/fileHash.ts`
  - `(name, size, firstNBytes)` から短いハッシュ文字列を返す純粋関数。
- `src/pose-particles/automation/fileHash.test.ts`
- `src/pose-particles/automation/AnalysisCache.ts`
  - `localStorage` ラッパ。`get(meta) / set(meta, payload)`。
    `cache.version` を埋め、schema 不一致なら無視して再解析する。
- `src/pose-particles/automation/AnalysisCache.test.ts`
  - localStorage を mock し、ヒット/ミス、quota 超過の握り潰し、
    version 不一致時の再解析挙動を検証。
- `src/pose-particles/ui/SectionTimeline.ts`
  - 画面下部に `position: fixed; bottom: 0` の canvas を配置。
    `BandTimeSeries.volume / bass / mid / treble` を時間軸でプロットし、
    境界縦線・現在時刻カーソルを描画する。
  - 境界編集ロジックは純粋関数 `pickBoundaryAt(boundaries, mouseT, hitWindowSec)` /
    `addOrRemoveBoundary(boundaries, mouseT, hitWindowSec)` に切り出してテスト
    可能にする。Canvas 描画とイベントハンドリングは手動確認。
- `src/pose-particles/ui/SectionTimeline.test.ts`
  - 上記純粋関数の単体テスト（DOM 抜き）。

修正:

- `src/pose-particles/settings.ts`
  - `Settings.auto` を追加（後述）。`makeDefaultSettings()` を拡張。
  - `MOTION_TARGETS` には影響しない（auto と body-motion は直交）。
- `src/pose-particles/App.ts`
  - `FileAudioSource` の load 完了で `SongAnalyzer` → `SectionDetector` →
    `AnalysisCache` を回し、`ParameterAutomation` を構築する。
  - `update()` 内、`cloneSettings(this.settings)` の直後に
    `auto.enabled && parameterAutomation && audioInput.isFile()` の条件で
    `parameterAutomation.applyAt(t, live)` を呼ぶ。
  - 既存 `motion.target` の `applyMotionTo(live, ...)` は auto 適用 **後** に
    走らせる（auto と body-motion を直交させる）。
- `src/pose-particles/audio/FileAudioSource.ts`
  - `getDecodedBuffer(): AudioBuffer | null` と `getCurrentTime(): number` を
    追加。
- `src/pose-particles/audio/AudioAnalyzer.ts`
  - `computeBands` は既に export 済み。SongAnalyzer から再利用するだけ。
- `src/pose-particles/ui/SettingsPanel.ts`
  - 「Auto Mode」フォルダを末尾に追加。`enabled` の変更時に対象 10 個の
    既存 controllers を `controller.disable()` / `enable()` する。
  - 「Re-analyze」ボタンが押されたら `App` のフックを呼んで再解析する。

### Settings 拡張

```ts
export interface AutoSettings {
  enabled: boolean;
  /** 境界補間の総幅 (秒)。前後 transitionSec/2 が補間ゾーン。 */
  transitionSec: number;
  /** 境界検出の novelty 閾値 (0..1)。 */
  noveltyThreshold: number;
  /** 連続境界をマージする最小間隔 (秒)。 */
  minSectionSec: number;
}
// Settings に追加
export interface Settings {
  // ...既存
  auto: AutoSettings;
}
```

`makeDefaultSettings()` で:

```ts
auto: {
  enabled: false,
  transitionSec: 1.5,
  noveltyThreshold: 0.4,
  minSectionSec: 4.0,
},
```

`AutomationMap` は spec で固定の `DEFAULT_AUTOMATION_MAP` をコード上で
持ち、Settings には保存しない（後で必要になったらユーザが値を編集できる
仕組みを別途追加する余地は残す）。

### データ型

```ts
// SongAnalyzer
export interface BandFrame {
  t: number;        // 秒
  volume: number;   // 0..1
  bass: number;     // 0..1
  mid: number;      // 0..1
  treble: number;   // 0..1
}
export interface BandTimeSeries {
  duration: number;   // 秒
  frames: BandFrame[];
  sampleRate: number;
}

// SectionDetector
export interface SectionBoundary {
  t: number;
  source: "auto" | "user-add";
}
export interface Section {
  start: number;      // 秒
  end: number;        // 秒
  energyNorm: number; // 0..1, 曲内 min-max 正規化
  bassAbs: number;    // 0..1, 絶対値
  midAbs: number;     // 0..1
  trebleAbs: number;  // 0..1
}
export interface DetectorOptions {
  noveltyThreshold: number;
  minSectionSec: number;
}

// AutomationMap
export interface AutomationEntry {
  target: string;     // ドット記法パス
  base: number;
  we: number;         // weight for energyNorm
  wb: number;         // weight for bassAbs
  wm: number;         // weight for midAbs
  wt: number;         // weight for trebleAbs
  min: number;
  max: number;
}
export type AutomationMap = ReadonlyArray<AutomationEntry>;
```

### 算出式

```
out = clamp(base + we*energyNorm + wb*bassAbs + wm*midAbs + wt*trebleAbs, min, max)
```

### DEFAULT_AUTOMATION_MAP（10 エントリ）

| target | base | we | wb | wm | wt | min | max | 意図 |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| color.hueBase | 0.66 | 0 | -0.66 | -0.33 | 0 | 0 | 1 | bass で赤、mid で緑、treble で青 |
| color.saturation | 0.3 | 0.7 | 0 | 0 | 0 | 0 | 1 | 盛り上がりで彩度↑ |
| color.bassHueShift | 0.0 | 0.0 | 0.5 | 0 | 0 | 0 | 1 | bass の濃さで色相シフトを増す |
| pointCloud.bassExpansion | 1.0 | 2.0 | 4.0 | 0 | 0 | 0 | 8.0 | bass で粒子クラスタが膨らむ |
| pointCloud.trebleShimmer | 0.02 | 0.04 | 0 | 0 | 0.10 | 0 | 0.20 | treble で粒子が震える |
| pointCloud.volumeSize | 4.0 | 10.0 | 0 | 0 | 0 | 2.0 | 20.0 | 盛り上がりで点が大きくなる |
| fragmentField.midDrift | 0.5 | 0.3 | 0 | 1.5 | 0 | 0 | 2.5 | mid（ボーカル帯）で粒子が漂う |
| fragmentField.jointPull | 0.02 | 0.04 | 0 | 0.04 | 0 | 0 | 0.15 | mid で人体輪郭が強調される |
| blur.strength | 0.3 | 0.7 | 0 | 0 | 0 | 0 | 2.0 | 盛り上がりでブラーが強くなる |
| camera.autoRotateSpeed | 0.0 | 2.0 | 0 | 0 | 0 | 0 | 4.0 | 盛り上がりでカメラが回り出す |

実装後、手動確認時にチューニングする想定。値の型と単位は既存
`makeDefaultSettings()` の値レンジに揃えてある。

### 解析パイプライン詳細

`SongAnalyzer.run(audioBuffer)`:

1. `OfflineAudioContext(numCh, length, sampleRate)` を作成。
2. `BufferSource → AnalyserNode (fftSize=2048)` を接続し、
   `AnalyserNode` に `ScriptProcessor` ではなく **`OfflineAudioContext` の
   `suspend(t)` + `resume()`** で約 50ms ごとに駆動して
   `getByteFrequencyData()` を読み出す。
3. 各時刻で既存 `computeBands()` を呼んで `BandFrame` を作る。
4. `BandTimeSeries { duration, frames, sampleRate }` を返す。

`SectionDetector.detect(series, options)`:

1. 各 frame を `[bass, mid, treble]` の単位ベクトル化（ノルム 0 のフレームは
   ゼロベクトルのまま扱う）。
2. 連続 frame 間の **`(1 - cosSimilarity) / 2`** を novelty 列にする
   （0..1 にスケール、`noveltyThreshold` の 0..1 GUI スライダと整合）。
   片側または両側がゼロベクトル（無音）のときは 0 を返す。これにより打楽器の
   単発 hit (`silence → spike → silence`) は境界として検出されない。
3. 20 フレーム (≈1 秒) の移動平均で平滑化。
4. 局所最大点を抽出し、`noveltyThreshold` を超えるものを境界候補に。
5. 境界の前後が `minSectionSec` 未満ならマージ。
6. `boundaries[]` と `sections[]` を返す。
   - 境界が 0 個なら `sections` は曲全体を覆う 1 個になる。
   - `energyNorm` 計算では `series.frames.map(f => f.volume)` の min/max
     を取る。`max - min` がほぼゼロのときは全セクション 0.5 にフォールバック。

**設計判断: amp-only シフト（形状不変の音量変化）は detect では境界が立たない。**
cosine novelty は形状（スペクトル比）の変化のみ捉える設計とし、純粋な音量変化を
境界として検出することは意図的に行わない。理由は、L2 距離やハイブリッドだと打楽器の
transient（kick/snare）が周期的に大きな novelty を出して誤検出につながるため。
ユーザが「ここが盛り上がりの始まり」と感じる箇所は、SectionTimeline の波形 UI で
手動で境界を追加することで対応する。`energyNorm` の min-max 正規化機能自体は、
detect 経由でも recomputeSections 経由でも動作する。

### ParameterAutomation 詳細

```ts
class ParameterAutomation {
  applyAt(t: number, live: Settings): void {
    // 1. 二分探索で t が属するセクション i を求める。sections.length === 1 なら
    //    補間なしでそのセクションの特徴量で算出する。
    // 2. 直近の境界が ±transitionSec/2 の窓内なら、隣接セクション i-1↔i または i↔i+1
    //    の特徴量を smoothstep(d / transitionSec) で線形補間する。
    //    曲頭・曲末は片側のセクションがないので補間しない。
    // 3. 補間後の features を AutomationMap に通し、setByPath で live に書き込む。
  }
}
```

### UI 詳細

`SettingsPanel` 末尾に追加するフォルダ:

```
[ Auto Mode ]
  enabled            checkbox
  transitionSec      0.5..3.0  既定 1.5
  noveltyThreshold   0.0..1.0  既定 0.4
  minSectionSec      1..10     既定 4
  Re-analyze         button
```

`enabled` 切替時に、`AutomationMap` の `target` 群（10 個）に対応する
既存 controllers を `disable()` / `enable()` する。Auto モード時の手動値は
ユーザの保存値そのままが薄く表示される（実際の live 値は auto 出力）。

`SectionTimeline`:

- 画面下部に `position:fixed; bottom:0; height:96px; width:100vw` の canvas。
- `auto.enabled = true` のときのみ表示。
- 縦軸は 0..1 の正規化エネルギー。下から順に bass(赤)・mid(緑)・treble(青) を
  半透明 stroke、volume を白塗りで描画。境界は白縦線（user-add は黄）、
  現在時刻は明るい黄縦線。
- マウスクリック: クリック X 座標を時刻に変換し、`hitWindowSec` (= 表示幅
  にして約 8px に相当する秒数を毎フレーム計算) を渡して
  `addOrRemoveBoundary(boundaries, mouseT, hitWindowSec)` の純粋関数で新しい配列
  を作り、`SectionDetector.recomputeSections(series, boundaries)` でセクション
  特徴量を再計算 → `ParameterAutomation` を作り直し → `AnalysisCache` を更新。

### 解析中 UI

ファイル decode 完了で:

1. キャッシュヒットなら何も表示せず即時 `ParameterAutomation` 構築。
2. ミスなら画面中央に "Analyzing song…" の素朴な fixed div を表示し、
   `SongAnalyzer.run()` を await。完了後にオーバーレイを消す。

### App 結合

```ts
// App.ts (擬似)
async onSongLoaded(audioBuffer: AudioBuffer, fileMeta: FileMeta) {
  const cached = AnalysisCache.get(fileMeta);
  let series, boundaries, sections;
  if (cached) {
    ({ series, boundaries, sections } = cached);
  } else {
    showAnalyzingToast();
    series = await SongAnalyzer.run(audioBuffer);
    ({ boundaries, sections } = SectionDetector.detect(series, this.settings.auto));
    AnalysisCache.set(fileMeta, { version: 1, series, boundaries, sections });
    hideAnalyzingToast();
  }
  this.sectionTimeline.setData(series, boundaries);
  this.parameterAutomation = new ParameterAutomation(
    sections, boundaries, DEFAULT_AUTOMATION_MAP, this.settings.auto.transitionSec,
  );
}

// update() 内
const live = cloneSettings(this.settings);
if (this.settings.auto.enabled && this.parameterAutomation && this.audioInput?.isFile()) {
  const t = this.audioInput.getCurrentTime();
  this.parameterAutomation.applyAt(t, live);
}
if (live.motion.target !== "off") {
  applyMotionTo(live, live.motion.target, 1 + motion * live.motion.strength);
}
// ...以降の audio reactive 処理は live の値で動く
```

### エラー処理

- `decodeAudioData` 失敗: `SongAnalyzer.run()` は `null` を返し、`auto.enabled` でも
  live 上書きをスキップ + `console.warn` + UI に "Analysis failed"。
- `localStorage` quota 超過: `try/catch` でスルー（既存 `saveSettings` と同じ態度）。
- 古いキャッシュ schema: `cache.version` 不一致なら `null` 扱いで再解析。
- マイク入力で auto.enabled: `applyAt` をスキップし UI 通知。

### 実装順（worktree 内 TDD）

1. `automation/fileHash.ts` + テスト
2. `automation/AnalysisCache.ts` + テスト（localStorage を mock）
3. `automation/setByPath.ts` + テスト
4. `automation/AutomationMap.ts` + テスト（`DEFAULT_AUTOMATION_MAP` 含む）
5. `audio/SectionDetector.ts` + テスト（合成 BandTimeSeries）
6. `automation/ParameterAutomation.ts` + テスト（補間 + setByPath 結合）
7. `audio/SongAnalyzer.ts` + 純ロジックテスト
8. `settings.ts` への `auto` 追加
9. `audio/FileAudioSource.ts` への API 追加
10. `ui/SectionTimeline.ts` 純粋関数 + テスト、Canvas 描画
11. `ui/SettingsPanel.ts` への Auto フォルダ + disable
12. `App.ts` への結合
13. 手動動作確認（ユーザに依頼）

### テスト方針

| レイヤ | 自動テスト | 手動確認 |
|---|---|---|
| fileHash | ○ | |
| AnalysisCache | ○（localStorage mock） | |
| setByPath / AutomationMap.computeValue | ○ | |
| SectionDetector（純粋ロジック） | ○ | |
| SongAnalyzer（純ロジック分） | ○ | OfflineAudioContext は手動 |
| ParameterAutomation | ○ | |
| SectionTimeline（pure 関数） | ○ | Canvas 描画 + クリック |
| SettingsPanel | | disable / Re-analyze ボタン |
| App 結合 | | 全体（曲ロード → 解析 → 再生 → 境界編集） |

## スコープ外（やらないこと）

- マイク入力でのリアルタイム逐次解析（別 Issue 候補）。
- BPM / オンセット / コード進行の検出。
- `AutomationMap` を GUI から編集する仕組み（コード固定で開始）。
- 波形上での境界ドラッグ移動（追加・削除のみ）。
- 解析時間が極端に長い曲のチャンク分割（曲長 10 分程度までは
  OfflineAudioContext で問題ないと想定）。
