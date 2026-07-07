# #227 ノードの名前・カテゴリの再整理（役割ベース 7 カテゴリ）

Issue: https://github.com/mishi5/three-art/issues/227

## 決定事項（ユーザ合意済み）

- 旧 6 カテゴリ（input / generator / process / visual / effect / output）を、
  役割ベースの **7 カテゴリ（source / control / audio / render / composite / effect / output）** に再編する。
- **ノード type の rename は一切行わない**（カテゴリのみ変更）。
  - category は NodeTypeDef 側の属性でシリアライズ対象外のため、既存シーン・プロジェクトの
    マイグレーションは不要。type を rename すると保存済みグラフが壊れるため見送り。
- カテゴリの表示順も source → control → audio → render → composite → effect → output とする。

## 目標マッピング（全 52 ノード）

| カテゴリ | ノード数 | ノード type |
| --- | --- | --- |
| source | 11 | CameraInput, MicInput, DisplayInput, VideoFileInput, AudioFileInput, ImageFileInput, SceneInput, MidiPad, TextureGenerator, Number, Time |
| control | 12 | Sine, Noise, RandomValue, Pulse, TapSequencer, FlipFlop, Envelope, Add, Multiply, Remap, Smooth, PoseFeatures |
| audio | 5 | AudioMix, AudioDelay, AudioFilter, AudioGain, AudioReverb |
| render | 7 | PointShape, PointTransform, ParticleRender, PointCloudVisual, EdgeVisual, RainVisual, GraphVisual |
| composite | 3 | Blend, Key, TextureSequencer |
| effect | 12 | Bloom, Blur, ColorGrade, Crt, Distort, Feedback, Flash, Fractal, Kaleidoscope, Pixelate, RgbShift, TextureTransform |
| output | 2 | Screen, AudioOutput |

## 実装

- `src/apps/node-vj/graph/node-type.ts`
  - `NODE_CATEGORIES`（表示順の一覧定数）と `NodeCategory`（union 型）を追加し**単一情報源**とする。
  - `NodeTypeDef.category` を `NodeCategory?` に厳格化（不正カテゴリはコンパイルエラー）。
- `src/apps/node-vj/editor/node-menu.ts`
  - `CATEGORY_ORDER` を `NODE_CATEGORIES` の参照に変更（右クリックメニュー #103 と
    ノード追加パネル #243 は `groupNodesByCategory` 経由で自動追従）。
  - 未知/未設定カテゴリを末尾 "other" にまとめるフォールバックは維持。
- `src/apps/node-vj/editor/layout.ts`
  - `CATEGORY_COLORS` を 7 カテゴリに再定義。source=旧 input（青）・control=旧 generator/process（緑）・
    render=旧 visual（紫）・effect/output=旧色流用。audio（琥珀 #5a4a2a）・composite（青緑 #2a5a5a）を新設。
    未知カテゴリの "#333" フォールバック（NodeEditor / clip-thumbnail 側）は維持。
- 各ノード定義（38 ファイル）: `category` を目標マッピングへ変更。
- `src/apps/node-vj/nodes/registry.ts`: 登録順（＝メニュー内の表示順）を新カテゴリ順に整理。
- 表示名: ノード追加パネルは category id を CSS capitalize でそのまま表示（#243）、
  右クリックメニューも category id を直接表示するため、新 id（Source/Control/…）が自動で出る。
  i18n カタログにカテゴリ名キーは存在しないため追加変更なし。
- AI API（`getNodeCatalog()`）は category パススルーのため自動追随。

## テスト

- 追加: `src/apps/node-vj/nodes/registry.test.ts`
  - 全ノードの category が `NODE_CATEGORIES` のいずれかであること（網羅・registry 走査）。
  - 7 カテゴリすべてが 1 ノード以上を持つこと。
- 追加: `layout.test.ts` に CATEGORY_COLORS が 7 カテゴリすべての色を持つ検証。
- 追随: 各ノードの category 文字列比較テスト・node-menu / node-add-panel のカテゴリ順テストを
  新カテゴリへ更新（テスト件数 1404 → 1407・全件パス、`bunx tsc --noEmit` exit 0）。
