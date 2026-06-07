# 設計＋実装計画: ノードエディタ最小実装（＋グラフコア実装）

- 対象 Issue: https://github.com/mishi5/three-art/issues/60
- 親 Epic: https://github.com/mishi5/three-art/issues/56
- 先行 ADR: `docs/plans/2026-06-07-57-node-vj-app-split-adr.md`,
  `docs/plans/2026-06-07-59-graph-core-adr.md`

## 目的

ADR #59 のグラフコア（データモデル・ポート型・評価エンジン・ランタイム）を実装し、
その上で「ノードの配置・接続・パラメータ編集・グラフ評価結果のプレビュー描画」が
できる最小のノードエディタを `node-vj.html` で動かす。

## 確定方針（#60 ブレインストーミング）

- エディタ描画: **Canvas 2D に全描画**（配線・ヒット判定・param ウィジェット自前）。
  テキスト/数値の編集時のみ HTML input を一時オーバーレイ。
- レイアウト: **エディタ主（全画面 canvas）＋ 3D プレビュー PiP（隅の小 canvas）**。
- MVP ノード: **Number / Time / Multiply / RainVisual**（core RainField ラップ）。
  pose/audio 本格ノードは #61。

## ディレクトリ構成

```
src/apps/node-vj/
  graph/
    port-types.ts    PortType 定義と接続互換判定
    node-type.ts     NodeTypeDef/ParamDef/PortDef/NodeRegistry
    graph-doc.ts     GraphDoc/NodeInstance/Connection + 操作関数
    evaluator.ts     pull 評価（トポロジカル + フレーム内メモ化 + 循環ガード）
    runtime.ts       GraphRuntime（renderer/scene/camera + 毎フレーム評価→描画）
  nodes/
    NumberNode.ts / TimeNode.ts / MultiplyNode.ts / RainVisualNode.ts
    registry.ts      既定ノードをレジストリ登録
  editor/
    NodeEditor.ts    Canvas2D 描画・入力ハンドリング
    param-overlay.ts param 編集用の一時 HTML input
  main.ts            エディタ + プレビュー(PiP) + runtime + 既定グラフ
```

## データモデル（ADR #59 準拠）

```ts
type PortType = "number"|"vec2"|"vec3"|"color"|"pose"|"audio"|"texture"|"trigger";
interface PortDef { id: string; label: string; type: PortType; }
interface ParamDef { id; label; kind: "number"|"int"|"boolean"|"enum"|"string";
                     default; min?; max?; step?; options?; }
interface NodeTypeDef { type; category?; inputs: PortDef[]; outputs: PortDef[];
                        params: ParamDef[]; isSink?: boolean;
                        evaluate(ctx): Record<string,unknown>; }
interface NodeInstance { id; type; params: Record<string,unknown>; position?: {x,y}; }
interface Connection { id; from:{node,port}; to:{node,port}; }
interface GraphDoc { version; nodes: NodeInstance[]; connections: Connection[]; }
```

`evaluate(ctx)` の `ctx`: `{ timeSec, input(portId): unknown, param(id): unknown, node }`。
visual sink は `ctx` から param を組み立て core モジュールを `update` し、`{}` を返す。

## 評価エンジン

- 毎フレーム sink ノード（`isSink` or 出力辺なし）から逆引きでトポロジカル評価。
- `visited: Map<nodeId, Record<port, value>>` でフレーム内 1 回評価。
- 入力ポート値: 接続があれば上流出力、なければノード param 値にフォールバック。
- 循環: 接続追加時に DAG 違反を拒否（`graph-doc`）。評価時も訪問中スタックでガード。

## 実装順（TDD）

各ステップで先にテストを書き、`bun run test` 全件パスを関門とする。
ヘッドレス層（graph/ と純粋 nodes）はユニットテスト、Canvas/THREE 層はブラウザ確認。

1. **port-types**: `isCompatible(from,to)`（厳密一致）。テスト→実装
2. **node-type / registry**: NodeRegistry の登録・取得。テスト→実装
3. **graph-doc**: add/removeNode, addConnection（自己接続/型不一致/循環/重複入力を拒否）,
   removeConnection。テスト→実装
4. **evaluator**: トポロジカル順序・フレーム内メモ化・未接続フォールバック・循環ガード。
   スタブノードでテスト→実装
5. **純粋ノード**: Number/Time/Multiply の evaluate。テスト→実装
6. **RainVisualNode**: core RainField をラップした sink（baseSpeed/count を number 入力、
   未接続時 param）。薄い構造テスト＋ブラウザ確認
7. **runtime（GraphRuntime）**: 毎フレーム evaluate→render。ブラウザ確認
8. **editor（NodeEditor）+ param-overlay**: Canvas2D 描画・移動・接続・削除・param 編集。
   ブラウザ確認
9. **main.ts**: 全画面エディタ + PiP プレビュー + 既定グラフ
   （Time→Multiply→RainVisual.baseSpeed, Number→Multiply）。ブラウザ確認

## 既定グラフ（プレビュー実証）

`Time(秒) → Multiply(×Number) → RainVisual.baseSpeed`、`Number(定数) → Multiply` を
初期配置。Number を編集すると雨の落下速度がプレビューに反映される＝
配置・接続・param・プレビューの一通りを実証。

## 検証

- `bun run test` 全件パス（既存 412 + 新規ヘッドレステスト）
- `bunx tsc --noEmit` クリーン
- `bun build` マルチエントリ成功
- ブラウザ: `bun run dev:vj` で配置/接続/param/プレビューを手動確認

## リスクと緩和

- Canvas2D エディタの自前描画・ヒット判定が複雑 → ヘッドレス graph 層を厚くテストし、
  UI 層は薄く保つ。座標変換（パン/ズーム）は MVP では固定（パンのみ、ズームは将来）
- 既存挙動には影響なし（node-vj は別エントリ、core は読むだけ）
