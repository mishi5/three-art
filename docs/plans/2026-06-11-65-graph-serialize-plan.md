# 実装計画: グラフのシリアライズ（YAML・named プリセット）

- 対象 Issue: https://github.com/mishi5/three-art/issues/65
- 親 Epic: https://github.com/mishi5/three-art/issues/56
- 先行 ADR: `docs/plans/2026-06-07-59-graph-core-adr.md`

## 目的

グラフ構成（ノード/接続/パラメータ/位置）の保存・読込を実装する。

## 確定方針（#65 ブレインストーミング）

- **node-vj 独自ストア＋YAML 互換 UX**。pose-particles の Settings プリセットとは
  データ構造が別物のため相互変換はせず、同じ yaml ライブラリ・同様の UX（YAML
  書出/読込・named プリセット）を踏襲する。

## 実装

### 1. `graph/serialize.ts`（純粋・TDD）
- `serializeGraph(g: GraphDoc): string` — YAML.stringify（version/nodes/connections、position 含む）
- `deserializeGraph(text, registry): { graph: GraphDoc; warnings: string[] }` — 検証つき復元
  - version 不一致 → throw
  - 未知ノード type → ノードを捨てて warning
  - params: 既知 ParamDef にマージ（欠落=default、未知キー=捨てる）
  - connections: `addConnection` で再検証（型/循環/重複/不在 → 捨てて warning）
- ラウンドトリップテスト

### 2. `graph/graph-doc.ts` 追補
- `replaceGraph(target, loaded)`: 既存 GraphDoc を**その場で置換**（editor/runtime の参照維持。
  visual state は GraphRuntime.syncStates が自動生成/破棄）

### 3. `graph/graph-store.ts`（named プリセット）
- storage adapter 注入（テストは memory）。`list/save/load/remove`、
  キー `node-vj.graphs.v1.<name>`

### 4. `editor/graph-io-bar.ts`（UI・main から分離）
- [名前入力][保存][読込 select][削除] ｜ [YAML 書出(download)][YAML 読込(file)]
- 読込/インポートは deserialize → replaceGraph。warnings は console + 簡易トースト

## テスト

- serialize: ラウンドトリップ / 未知 type 除去 / 不正接続除去 / params マージ / version 検証
- graph-store: memory adapter で CRUD
- ブラウザ（Playwright + 手動）: 保存→読込で復元・YAML 書出/読込・エラー0

## リスク

- 読込時の visual state 差し替え → #63 の dispose 修正（stateDefs）で安全
- ノード id 衝突（読込後に追加） → genId はタイムスタンプ+連番で実質衝突なし
