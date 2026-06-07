# 実装計画: 入力ノード化（PoseInput / AudioInput）

- 対象 Issue: https://github.com/mishi5/three-art/issues/61
- 親 Epic: https://github.com/mishi5/three-art/issues/56
- 先行 ADR: `docs/plans/2026-06-07-57-node-vj-app-split-adr.md`,
  `docs/plans/2026-06-07-59-graph-core-adr.md`

## 目的

既存の pose/audio 入力をグラフのノードとして提供する。あわせて ADR #58 で #61 に
先送りした pose/audio モジュールの core 移動を行う。

## 確定方針（#61 ブレインストーミング）

- pose 出力は `pose` バンドル（{joints, visibility, center}）＋ `motion`（number）。
- AudioInput は bands / onset に加え **sections も #61 に含める**（file ソース時のみ有効、
  mic/display は section=-1）。
- RainVisual に `audio` 入力ポートを追加（未接続時 env.audio フォールバック）。
- デモはトグル追加方式（既定グラフは #60 のまま据え置き）。

## A. pose/audio を core へ移動

- `src/apps/pose-particles/pose/` → `src/core/pose/`
- `src/apps/pose-particles/audio/` → `src/core/audio/`
- 解析結果型（BandFrame / BandTimeSeries / SectionBoundary / Section）を
  `src/core/audio/analysis-types.ts` に抽出。`automation/AnalysisCache`（app）は
  これを re-export ＋ `CachePayload` と localStorage キャッシュ機構を保持。
- SectionDetector / SongAnalyzer は解析型を `./analysis-types`（core）から import。
- App.ts の `./pose` `./audio` import を `../../core/pose` `../../core/audio` に更新。
- **挙動不変。既存テスト全件パスを関門。**

## B. core 型追加

- `src/core/types.ts` に `PoseFrame`（{joints, visibility, center}）を追加。

## C. 入力ノード（`src/apps/node-vj/nodes/`）

- **PoseInputNode**
  - `createState`: PoseInput（MediaPipe）＋ JointAnchors を生成し start。
  - `evaluate`: jointAnchors.tick() → 出力 `pose`（PoseFrame）, `motion`（number）。
  - 出力ポート: `pose`(pose), `motion`(number)。
- **AudioInputNode**
  - param `source`: enum(mic/file/display)。
  - `createState`: 選択ソースの AudioInput を保持（start は user gesture から）。
  - `evaluate`: read() → 出力 `audio`(audio), `volume/bass/mid/treble`(number),
    `onset`(trigger), `section`(number)。
  - onset: OnsetDetector を内部に持ち bass としきい値から trigger。
  - section: file ソース時に SongAnalyzer＋SectionDetector で boundaries 算出して
    state 保持、再生時刻から現在 index。mic/display は -1。
  - band/onset/section 抽出は純粋関数に切り出してテストする。

## D. RainVisual に audio 入力ポート

- inputs に `audio`(audio) を追加。evaluate で `ctx.input("audio") ?? env.audio`。

## E. デモ・起動コントロール

- 既定グラフは据え置き。ツールバーに PoseInput/AudioInput を追加できる。
- mic/camera は user gesture が要るため、main に最小 HTML コントロール
  （Start Mic / Load File）を置き、対象 AudioInput/PoseInput ノードの state を起動。

## 実装順（TDD）

1. core 移動（pose/audio + analysis-types 抽出 + import 修正）→ **既存テスト全パス関門**
2. PoseFrame 型追加
3. 純粋ロジック（band/onset/section 抽出, pose bundle 組み立て）テスト→実装
4. PoseInputNode / AudioInputNode（ポート定義・lifecycle）
5. RainVisual audio ポート追加（既存 RainVisual テストがあれば維持）
6. registry 登録・main 起動コントロール
7. tsc/build/全テスト、ブラウザ確認（カメラ/マイクはユーザ）

## 検証

- `bun run test` 全件パス（既存 + 新規）
- `bunx tsc --noEmit` クリーン / マルチエントリ build 成功
- Playwright スモーク: エディタに PoseInput/AudioInput を追加してもエラーが出ない
  （実カメラ/マイクはユーザ確認）

## リスクと緩和

- audio/section の app 結合（AnalysisCache 型）→ 解析型を core 抽出し app は re-export。
- 大量ファイル移動の import 切れ → 移動直後にテスト全件パスを関門。
- mic/camera は headless で検証不可 → 純粋ロジックを厚くテストし実機はユーザ確認。
