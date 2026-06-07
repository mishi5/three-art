# ADR: グラフコア基盤（ノード/ポート/接続/評価エンジン）

- ステータス: Accepted
- 日付: 2026-06-07
- 対象 Issue: https://github.com/mishi5/three-art/issues/59
- 親 Epic: https://github.com/mishi5/three-art/issues/56
- 先行 ADR: `docs/plans/2026-06-07-57-node-vj-app-split-adr.md`

## コンテキスト

Epic #56 で、固定パイプラインの pose-particles をノードグラフで自由に組み替えられる
VJ アプリ（node-vj）へ再構成する。本 ADR は、その中核となる
**ノードグラフのデータモデル・ポート型・評価エンジン・毎フレーム描画統合**を定義する。

前提となる構成（#57 / #58 で確定・実装済み）:
- 描画・エフェクトは `src/core/visuals` / `src/core/effects` に共有コンポーネント化済み。
  各モジュールは `Settings` 非依存の狭い param 型（`core/visuals/params.ts` 等）を受け取り、
  命令的な THREE オブジェクト（`object3D`）＋ `update(params)` で毎フレーム駆動される。
- node-vj は `src/apps/node-vj/` の別エントリ（`node-vj.html`）。

グラフは「入力ソース（pose/audio/時間）→ 変調・処理 → ビジュアル → 出力」を結ぶ
有向非循環グラフ（DAG）で、毎フレーム（60fps）評価して core モジュールを駆動する。

## 決定

### 決定 1: 自前ヘッドレスコア（ライブラリ非採用）

データモデルと評価エンジンを **DOM 非依存のヘッドレス core として自前実装**する。
litegraph.js / rete.js は採用しない。

- 理由: 評価タイミングと毎フレーム GPU 描画の統合・シリアライズを完全制御でき、
  bun で純粋ロジックとして TDD 可能。本プロジェクトは React を使わないため、
  framework 前提の既製エディタ（rete 等）は依存が重く、評価方式が制約される。
- エディタ UI（配置・接続・パラメータ編集）の実装は #60 で別途決定する。本 ADR の
  対象はヘッドレスなグラフランタイム（データモデル＋評価）に限る。

### 決定 2: 配置は `src/apps/node-vj/graph/`

グラフ評価コアは node-vj 専用ランタイムであり、pose-particles は使用しない。
そのため共有 `src/core/` ではなく **`src/apps/node-vj/graph/`** に配置する。
ロジック層は DOM / THREE 非依存に保ち、ヘッドレスでテストする。

```
src/apps/node-vj/graph/
  port-types.ts      ポート型の定義と接続互換判定
  node-type.ts       NodeTypeDef / レジストリ
  graph-doc.ts       GraphDoc / NodeInstance / Connection（シリアライズ単位）
  evaluator.ts       pull 評価エンジン（トポロジカル + フレーム内メモ化 + 循環検出）
  runtime.ts         GraphRuntime（renderer/scene/camera + 毎フレーム評価→描画）
```

### 決定 3: データモデル（JSON シリアライズ可能）

NodeType（種別・レジストリ）と NodeInstance（配置実体）を分離する。`GraphDoc` を
保存単位とし、#65 で既存 YAML プリセット機構と統合する。

```ts
type PortType =
  | "number" | "vec2" | "vec3" | "color"
  | "pose" | "audio" | "texture" | "trigger";

interface PortDef { id: string; label: string; type: PortType; }

interface ParamDef {
  id: string; label: string;
  kind: "number" | "int" | "boolean" | "enum" | "string";
  default: unknown;
  // number/int 用の範囲、enum 用の選択肢など（UI #60 が利用）
  min?: number; max?: number; step?: number; options?: string[];
}

// ノード種別（レジストリに登録される定義）
interface NodeTypeDef {
  type: string;                 // 例: "PoseInput" / "Multiply" / "PointCloudVisual"
  category?: string;            // UI 分類（input / process / visual / output）
  inputs: PortDef[];
  outputs: PortDef[];
  params: ParamDef[];
  /** 出力ポート値を返す。入力値・params・時間・フレーム文脈は ctx 経由で取得。 */
  evaluate(ctx: EvalContext): Record<string, unknown>;
  /** visual/output 系のみ: シーン在不在の管理や副作用の有無を示す。 */
  isSink?: boolean;
}

// 配置実体（保存対象）
interface NodeInstance {
  id: string;
  type: string;                 // NodeTypeDef.type を参照
  params: Record<string, unknown>;
  position?: { x: number; y: number };  // エディタ表示用（評価には不要）
}

interface Connection {
  id: string;
  from: { node: string; port: string };
  to:   { node: string; port: string };
}

interface GraphDoc {
  version: number;
  nodes: NodeInstance[];
  connections: Connection[];
}
```

- `NodeInstance` / `Connection` / `GraphDoc` は純データ（関数を持たない）→ JSON 化可能。
- `NodeTypeDef.evaluate` などの振る舞いはレジストリ側に持ち、保存対象に含めない。

### 決定 4: ポート型システム（リッチ型を最初から定義）

ポート型は最初から以下を定義する:
`number / vec2 / vec3 / color / pose / audio / texture / trigger`

- 値の対応（評価時のランタイム表現）:
  - `number`: number
  - `vec2`/`vec3`: number 配列（`[x,y]` / `[x,y,z]`）
  - `color`: `[r,g,b]`（0..1）
  - `pose`: `Joints`（`core/types` の Float32Array、length = NUM_JOINTS*3）と
    可視性・中心など付帯情報（pose バンドル）
  - `audio`: `AudioFeatures`（`core/types`）
  - `texture`: `THREE.Texture`（RT チェーン用、将来の post 連結）
  - `trigger`: イベント（onset 等）。MVP は boolean パルスで表現
- **接続互換判定**: 既定は `from.type === to.type` の厳密一致。不一致は接続を拒否。
  将来の暗黙変換（例 `number → vec3` のブロードキャスト）は許可テーブルで拡張可能に
  するが、MVP では厳密一致のみ。
- MVP で実際に配線するのは number / pose / audio と visual を駆動する経路。
  vec2/vec3/color/texture/trigger は型を定義しておき、対応ノードが追加された時点で有効化する。

### 決定 5: 評価エンジン（pull ＋ フレーム内メモ化）

毎フレーム、**sink ノード**（出力辺を持たない、または `isSink` の visual/output）から
入力方向へ逆引きし、トポロジカル順に評価する。

- `visited: Map<nodeId, Record<port, value>>` を用い、同一ノードは 1 フレーム 1 回だけ評価
  （複数下流から要求されても重複計算しない）。
- **循環検出**: 接続追加時に DAG 違反を検出して拒否する。評価時にも訪問中スタックで
  保険のガードを入れ、循環時は明示エラー。
- `EvalContext` は時間（`timeSec`）と、各入力ポートの解決済み値の getter を提供する。
- フレーム"間"で重い計算（曲解析など）をキャッシュしたいノードは、ノード内部に状態を
  持てばよい（評価方式自体は単純な pull のまま）。

選定理由: pose/audio が毎フレーム変化する本用途では、ほぼ全ノードが毎フレーム再計算
対象になるため push（dirty 伝播）の利得が小さく、状態管理の複雑さ・キャッシュ無効化バグの
リスクだけが増える。pull は実装・テストが最も単純で決定的。

### 決定 6: 毎フレーム描画統合

`GraphRuntime` が renderer / scene / camera と現在の `GraphDoc`（および型インスタンス）を
保持し、毎フレーム `evaluate()` → `renderer.render(scene, camera)` を回す。

- **visual ノード**は core モジュール（PointCloud / RainField / PostPipeline 等）を内部に
  保持する。evaluate 時に入力ポート値・params から core の param 型を組み立て
  `module.update(params)` を呼び、`module.object3D` のシーン在不在を管理する
  （副作用は evaluate 内で完結。`isSink: true`）。
- **出力（screen）ノード**が最終描画対象を表す。post チェーンは `texture` 型で接続する
  設計だが、MVP では単一の visual → screen 直結で開始する。

## 検討した代替案

### ライブラリ選定
1. **自前ヘッドレスコア（採用）**: 評価タイミング・描画統合・シリアライズを完全制御、
   bun で TDD 可能、React 非依存。
2. **litegraph.js**: model + canvas エディタ込みで早いが、評価タイミングと毎フレーム
   GPU 描画の統合・シリアライズがライブラリ仕様に引きずられる。
3. **rete.js**: 柔軟だが framework（React/Vue）前提が多く、本プロジェクトに重い依存。

### 評価方式
1. **pull ＋ フレーム内メモ化（採用）**: 連続入力の VJ に最適・単純・決定的。
2. **push（dirty 伝播）**: 静的グラフ向き。毎フレーム入力変化では利得が小さく複雑。
3. **hybrid（静的=push / 動的=pull）**: 理論上最適だが実装・テストが最も複雑、MVP に過剰。

### ポート型
1. **リッチ型を最初から定義（採用）**: 表現の幅を見越して型語彙を確定。未使用型は
   対応ノードが出た時点で有効化。
2. **最小型セット＋拡張**: 実装は軽いが、後から型語彙を増やすと互換ルールの再設計が要る。
3. **型なし（any）**: 実装は最軽量だが誤接続を防げず実行時エラーになりやすい。

## 結果（影響）

- node-vj に DOM 非依存・テスト可能なグラフランタイムの足場が定まる。
- 後続 Issue の前提が固まる:
  - #60 ノードエディタ UI（`GraphDoc` を編集し、接続時に型互換・循環を検査）
  - #61 入力ノード（PoseInput / AudioInput）— pose/audio を core へ寄せて出力ポート化
  - #62 処理ノード（JointAnchors / noise / twist / edge / sections）
  - #63 ビジュアルノード（PointCloud + 各レンダリングモード）— visual sink ノード化
  - #64 出力・ポストエフェクトノード（blur / edge overlay / post-effects）— texture 連結
  - #65 シリアライズ（`GraphDoc` ↔ 既存 YAML プリセット統合）
  - #66 外部入力拡張ノード（カメラ映像 / 動画 / OSC）

## 未決事項（後続 Issue で決める）

- 各ノード種別の正確なポート・param 定義（#61〜#64）
- エディタ UI のライブラリ／描画方式（#60）
- `GraphDoc` と既存 YAML プリセット・セクションタイムラインの統合方法（#65）
- 暗黙型変換の許可テーブルの要否（対応ノードが出た時点で判断）
- texture（RT）チェーンの具体設計（#64）
