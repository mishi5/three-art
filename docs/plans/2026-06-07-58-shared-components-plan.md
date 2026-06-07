# 実装計画: 共有コンポーネント切り出し（描画・エフェクト）

- 対象 Issue: https://github.com/mishi5/three-art/issues/58
- 親 Epic: https://github.com/mishi5/three-art/issues/56
- 先行 ADR: `docs/plans/2026-06-07-57-node-vj-app-split-adr.md`

## 方針

ADR の 2 段階移行に従う。**Phase A（純粋パス移動）→ Phase B（core 抜き＋狭窄化）**。
各ステップでテスト全件パスを関門とする。Phase B の初回スコープは visuals + effects
（pose / audio は #61）。

### 狭窄化のアプローチ

core の各モジュールは `Settings` を import せず、**自前の狭い param 型**を定義する。
各 param 型は `Settings` の対応サブフィールドと構造的に同一にするため、
pose-particles 側の App は `live`（Settings）を**そのまま渡せる**（Settings ⊇ Params
の構造的部分型）。毎フレームのアダプタ用オブジェクト生成は不要。これが ADR の
「Settings → core params アダプタ」の最小・ゼロコスト実装となる。

`Settings` 全体を受け取っていたのは PointCloud / FragmentField / EdgeOverlay /
RainField / PostPipeline（+ 各 PostEffect）の 5 系統のみ。twist / blur は既に狭い型、
value-noise / polyhedron-anchors / ImageSampler / SkeletonGuide は純粋関数。

## Phase A: パス移動（挙動完全同一）

1. `src/pose-particles/` → `src/apps/pose-particles/` へ `git mv`
2. `src/apps/pose-particles/ui/*.test.ts` の `../../test-setup/dom` →
   `../../../test-setup/dom`（3 箇所）。`src/test-setup/` は共有テスト基盤として据え置き
3. `pose-particles.html` の script src を `./src/apps/pose-particles/main.ts` に更新
4. `node-vj.html`（最小スケルトン）+ `src/apps/node-vj/main.ts`（プレースホルダ）追加
5. `package.json` scripts: `dev:vj` 追加、`build` をマルチエントリ化
6. **テスト全件パス関門**

## Phase B: core 抜き出し＋狭窄化（visuals + effects）

### B-1. 共有プリミティブ
- `src/core/types.ts` を新設（app types.ts の内容を移植）。
  app 側 `src/apps/pose-particles/types.ts` は `export * from "../../core/types"` に
- `src/core/visuals/render-mode.ts` 新設: `RenderMode` / `RENDER_MODES` /
  `modeToInt` / `PolyhedronFaces` / `POLYHEDRON_FACES` を settings.ts から移動。
  settings.ts はこれらを re-export

### B-2. 純粋・狭型モジュールを core/visuals へ
- twist.ts, blur.ts, value-noise.ts, polyhedron-anchors.ts, ImageSampler.ts,
  SkeletonGuide.ts を `src/core/visuals/` へ移動（テストも追従）
- import する app ファイルのパス更新（settings.ts, ui/randomize.ts, ui/SettingsPanel.ts）

### B-3. Settings 依存 visual を core/visuals へ＋狭窄化
- PointCloud.ts, FragmentField.ts, EdgeOverlay.ts, rain.ts を core/visuals へ移動
- 各 `update()` の `Settings` 引数を狭い param 型へ:
  - `PointCloudParams`（mode, pointCloud, shape, color, outlier, lattice, image, twist）
  - `FragmentFieldParams`（fragmentField, color, twist）
  - `EdgeOverlayParams`（mode, edges, outlier, pointCloud, shape, twist）
  - `RainParams`（mode, rain）
- 各 param 型は対応するサブ interface を core に持つ（Settings と構造一致）

### B-4. effects を core/effects へ＋狭窄化
- post/{PostPipeline, PostEffect, BlurEffect, KaleidoscopeEffect, FractalEffect} を
  `src/core/effects/` へ移動（テスト追従）
- `PostEffect.update(params, audio)` / `PostPipeline.update(params, audio)` を狭窄化:
  - `PostPipelineParams`（post, blur）。`SmoothedAudio` は core/effects に定義

### B-5. App 配線更新
- App.ts の visuals/effects import を `../../core/...` に更新
- update 呼び出しは `live` をそのまま渡す（構造的部分型で型チェック通過）

### B-6. node-vj スケルトンで共有を実証
- `src/apps/node-vj/main.ts` で core/visuals の 1 つ（例: PointCloud）を import し、
  最小描画（黒画面 + ログ）で「core が両アプリから使える」ことを確認

## 検証
- 各 B-x 後に `bun run test` 全件パス
- `bun build ./pose-particles.html ./node-vj.html --outdir dist --minify` 成功確認
- 既存挙動は move + signature 型変更のみでロジック不変 → リグレッションなし

## リスクと緩和
- 大量ファイル移動による import 切れ → モジュール単位でテスト関門
- 構造的部分型の取りこぼし → tsc（`bun build`）で型検証
