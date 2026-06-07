# ADR: node-vj アプリ分割・共有コンポーネント境界

- ステータス: Accepted
- 日付: 2026-06-07
- 対象 Issue: https://github.com/mishi5/three-art/issues/57
- 親 Epic: https://github.com/mishi5/three-art/issues/56

## コンテキスト

現状の pose-particles は単一エントリ `pose-particles.html` →
`src/pose-particles/main.ts` → `App.ts` の構成で、`App.ts`（約 800 行）が
scene / camera / renderer・全 visuals（PointCloud, FragmentField, EdgeOverlay,
SkeletonGuide, RainField）・PostPipeline・入力（PoseInput, 各 AudioSource）・
automation・presets・UI パネル・毎フレーム `update()` ループを一手に配線する
god-object になっている。

Epic #56 では、これを温存したまま別 URL でノードベース VJ アプリ
（`node-vj.html`）を新規実装し、描画・エフェクト・入力のコアロジックを両アプリで
共有することを目指す。本 ADR はその前提となる **アプリ分割とコード共有の境界**、
および **既存挙動を壊さない移行手順** を定義する。

### 現状の結合構造（調査結果）

共有の最大の論点は、visual の leaf モジュールがすべて
**モノリシックな `Settings` 型**（`src/pose-particles/settings.ts`）と
`types.ts` の `AudioFeatures` / `Joints` / `NUM_JOINTS` に依存している点である。

- `PointCloud` / `FragmentField` / `EdgeOverlay` / `PostPipeline` の `update()` は
  いずれも引数に `Settings` 全体を取る。
- `Settings` は `pointCloud` / `fragmentField` / `shape` / `color` / `post` /
  `lattice` / `image` / `rain` 等のサブオブジェクトを持つ巨大な集約型で、
  presets / randomize / automation / UI パネルからも参照される。

そのため「visual を共有レイヤへ出す」には、`Settings` 結合をどう扱うかを
先に決める必要がある。

## 決定

### 決定 1: 共有 visual は狭い per-module param 型を受け取る

共有レイヤの visual / effect モジュールは、モノリシックな `Settings` への依存を
やめ、各モジュール固有の **狭い param 型**（例: `PointCloudParams`,
`FragmentFieldParams`, `EdgeOverlayParams`, `PostPipelineParams`）を受け取る。

- 既存 pose-particles 側は **`Settings → core params` アダプタ** を介して橋渡しし、
  既存の挙動・GUI・preset 機構をそのまま保つ。
- node-vj 側は、グラフ評価結果から core param 型を直接生成してモジュールを駆動する。

これにより共有レイヤは `Settings` を一切 import しない疎結合な状態になり、
2 アプリが同じ描画コアを別のデータソースから駆動できる。

### 決定 2: ディレクトリ構成は `src/core` + `src/apps/*`

```
pose-particles.html          (既存・URL 温存)  → src/apps/pose-particles/main.ts
node-vj.html                 (新規・別 URL)    → src/apps/node-vj/main.ts

src/core/                    ← 共有レイヤ（Settings に依存しない）
  types.ts                   AudioFeatures / Joints / NUM_JOINTS
  visuals/                   PointCloud, FragmentField, EdgeOverlay, SkeletonGuide,
                             RainField, ImageSampler, twist, value-noise, rain,
                             polyhedron-anchors, blur
  effects/                   PostPipeline, BlurEffect, KaleidoscopeEffect,
                             FractalEffect, PostEffect
  pose/                      JointAnchors, PoseInput
  audio/                     AudioAnalyzer, *AudioSource, OnsetDetector,
                             SectionDetector, SongAnalyzer

src/apps/pose-particles/     ← 既存固有レイヤ（Settings を所有）
  App.ts, main.ts, settings.ts, ui/, presets/, automation/
  settings-to-core-params.ts ← Settings → core param 型のアダプタ（新規）

src/apps/node-vj/            ← 新規（中身は #59 以降で実装）
  main.ts
```

#### 共有 / 固有の境界

| レイヤ | 配置 | 理由 |
| --- | --- | --- |
| 描画 (visuals) | `src/core/visuals` | 両アプリの描画コア。Settings 非依存に狭窄化 |
| エフェクト (post) | `src/core/effects` | 同上 |
| pose 入力 | `src/core/pose` | #61 で両アプリ共有。MediaPipe ラップ |
| audio 入力・解析 | `src/core/audio` | #61 で両アプリ共有 |
| 共有プリミティブ型 | `src/core/types.ts` | AudioFeatures / Joints 等 |
| `Settings` データモデル | `src/apps/pose-particles` | 既存固定パイプライン専用 |
| `ui/` パネル群 | `src/apps/pose-particles` | 既存 GUI 専用（node-vj は別 UI） |
| `presets/` | `src/apps/pose-particles` | Settings ベース。node-vj は #65 で別途統合 |
| `automation/` | `src/apps/pose-particles` | Settings を時間駆動。node-vj は別機構 |

> 補足: `presets` / `automation` のグラフ統合は Epic の将来スコープ（#65）。本 ADR では
> pose-particles 固有のまま据え置き、node-vj 側のシリアライズは別 Issue で設計する。

### 決定 3: 移行は「パス移動 → core 抜き＋狭窄化」の 2 段階

既存挙動を壊さないため、移動と狭窄化を分離する。実行は #58 が担当する。

- **Phase A（純粋移動・挙動完全同一）**
  - `src/pose-particles/` → `src/apps/pose-particles/` へパス移動のみ。
    相対 import の調整に留め、ロジックは一切変更しない。
  - `node-vj.html`（最小スケルトン）を追加し、`bun build` をマルチエントリ化。
  - **全テスト緑を関門**とする。
- **Phase B（core 抜き出し＋狭窄化）**
  - leaf モジュールを 1 つずつ `src/core/` へ移動 → 狭い param 型を導入 →
    pose-particles 側はアダプタ経由に切り替え。
  - **各モジュール移動ごとにテスト全件パスを関門**とする。
  - 回帰防止のため、既存テストは core 側へ追従移設する。

#### core 抜き出しの初回スコープ

- **#58 の初回抜き出し対象は visuals + effects に絞る。**
- **pose / audio は #61（入力ノード化）のタイミングで core へ寄せる。**
  これにより各 Issue の diff を小さく保ち、レビューと回帰確認を容易にする。

### 決定 4: bun マルチエントリ・ビルド

`bun build` は複数 HTML エントリポイントを受け付けるため、両エントリを 1 コマンドで
ビルドする。dev は `--hot` の対象が単一エントリのため、アプリごとに分ける。

```jsonc
// package.json scripts
"dev":     "bun --hot ./pose-particles.html",      // 既存（温存）
"dev:vj":  "bun --hot ./node-vj.html",             // 新規
"build":   "bun build ./pose-particles.html ./node-vj.html --outdir dist --minify",
"test":    "bun test --isolate"                    // 変更なし
```

> 検証メモ: マルチエントリ build / dev の実挙動確認は Phase A（#58）実装時に行う。
> 問題があれば dev / build を 2 コマンド構成へ分割するフォールバックを取る。

## 検討した代替案

### Settings 結合の扱い

1. **段階移行（leaf を Settings 依存のまま core へ移し、狭窄化は各ノード Issue に先送り）**
   - 利点: #58 の diff が最小、挙動保存が容易。
   - 欠点: 共有レイヤが当面 `Settings` に結合したままで、node-vj 側が full Settings を
     合成する必要があり、ノード境界が濁る。
2. **Settings 型を共有の正とする**
   - 利点: アダプタ不要。
   - 欠点: node-vj が pose-particles のデータモデルに恒久的に縛られ、Epic のビジョン
     （自由なデータフロー）に反する。
3. **先に狭窄化リファクタ（採用）**
   - 利点: 共有レイヤが Settings 非依存になり、ノード境界がクリーン。
   - 欠点: 切り出し時のリファクタ量とリスクが増す → 決定 3 の 2 段階移行と
     回帰テストで緩和する。

### ディレクトリ構成

1. **`src/core` + `src/apps/*`（採用）**: 共有 / 固有の境界がディレクトリで明確。
2. **`src/shared` 追加・既存据え置き**: 移動量は最小だが、既存が `src/pose-particles`、
   新規が `src/node-vj` と非対称で構成が読みにくい。
3. **`src` 直下に core / pose-particles / node-vj をフラット配置**: apps 階層がない分
   将来アプリ追加時に整理しづらい。

## 結果（このアプローチの影響）

- 共有レイヤ（`src/core`）が `Settings` 非依存になり、pose-particles と node-vj が
  同一の描画・エフェクト・入力コアを別データソースから駆動できる。
- 既存 `pose-particles.html` は URL・挙動ともに温存される（Phase A は挙動完全同一、
  Phase B は各ステップでテスト全件パスを関門とする）。
- 後続 Issue の足場が定まる:
  - #58 共有コンポーネント切り出し（Phase A 全体 + Phase B の visuals/effects）
  - #59 グラフコア基盤の設計 ADR（本 ADR の境界を前提）
  - #61 入力ノード化（pose/audio を core へ寄せる）
  - #63 ビジュアルノード化（core param 型をノードのポートに対応づけ）
  - #64 出力・ポストエフェクトノード化
- リスク: 狭窄化リファクタによる既存挙動の退行。→ 2 段階移行・モジュール単位の
  テスト関門・既存テストの core 追従移設で緩和する。

## 未決事項（後続 Issue で決める）

- グラフ評価エンジン（pull / push）と毎フレーム GPU 描画の整合（#59）
- node-vj 側のシリアライズと既存 YAML プリセットの統合方法（#65）
- core param 型の正確なフィールド定義（各ノード Issue で確定）
- ノードエディタ UI ライブラリ選定（自前 / litegraph.js / rete.js 等）（#59 / #60）
