# #208 全 number 出力ポート共通の倍率（スケール）設定

Issue: https://github.com/mishi5/three-art/issues/208

## 目的

全ノードの number 型出力ポートに共通機能として「倍率（スケール）」を設定できるようにする。
出力値に倍率を掛けてから下流へ渡す。デフォルト 1（＝従来と完全に同じ挙動）。
コンパクトな UI。値はプロジェクト保存に含める（永続化）。

## 受け入れ条件（対応状況）

- [x] number 出力ポートで倍率を設定でき、下流に「元の値 × 倍率」が流れる。
- [x] デフォルト 1 で従来と完全に同じ挙動。
- [x] コンパクトな UI で全 number 出力に共通適用される。
- [x] 設定値が保存・復元される（シリアライズ往復で保持）。
- [x] オフセット（加算）はスコープ外。倍率のみ。

## データモデル

`NodeInstance` に出力ポート単位の倍率を保持するフィールドを追加（params とは別管理）。

```ts
interface NodeInstance {
  // ...
  /** #208: number 出力ポート単位の倍率。portId → 倍率。未設定/1 は従来挙動。 */
  outputScales?: Record<string, number>;
}
```

- 既定 1 のポートはエントリを持たない（`setOutputScale` が 1/非有限値で削除）。保存をクリーンに保ち、
  「設定していない＝従来挙動」を構造的に保証する。

## 純関数（`graph/output-scale.ts`）

- `applyOutputScales(outputs, def, scales)`: number 型出力ポート値に倍率適用した Record を返す。
  - scales 未指定／全ポート既定 1 のときは **入力 outputs をそのまま（同一参照）返す** → 従来と完全に同じ挙動を保証（回帰防止の要）。
  - number 型ポートのみ対象（signal/texture/audio 等は無視）。
  - 倍率が非数値/非有限/1 のポートは素通し。出力値が number でない（NaN/undefined/配列）ポートも素通し。
- `getOutputScale(node, portId)` / `setOutputScale(node, portId, scale)`: 取得/設定ヘルパ。
- `formatScale(scale)`: チップ表示文字列（×2 / ×0.5 等）。

## 評価器（`graph/evaluator.ts`）

各ノードの `def.evaluate(ctx)` 直後に `applyOutputScales` を適用し、memo 記録・下流伝播の値を倍率適用済みにする。
`runtime.getOutputs(nodeId)` は memo を返すため自動的に倍率反映（ライブ値表示も倍率後の値）。

## シリアライズ（`graph/serialize.ts`）

- 保存: `YAML.stringify` がそのまま `outputScales` を書き出す（純データ）。
- 復元: `def.outputs` の number 型ポートかつ有限数値のみ採用。未知ポート・非数値・非有限は捨てる。
  有効エントリが 1 つも無ければ `outputScales` を付けない（既定挙動に戻す）。

## UI（`editor/NodeEditor.ts` + `editor/layout.ts`）

- number 出力ポート行の右端に「倍率チップ」（`outputScaleChipRect`）を描画。
  - 倍率 1 のときは控えめ（暗色・グレー文字）。1 以外は強調（緑）。出力ラベルはチップの左へ寄せて重なり回避。
- チップクリックで数値入力オーバーレイ（`openParamInput`, kind="number"）を開き、倍率を編集。
  commit 時に `history.record` → `setOutputScale`（undo 対応）。1/非有限はエントリ削除＝既定へ。
- hitTest 上はチップ位置が `{kind:"node"}` ヒットになるため、onDown のノード分岐内でチップ矩形を判定して編集を開く。

## 複製（`graph/duplicate.ts`）

倍率は機能的設定のため、ノード複製時に `outputScales` を深いコピーで引き継ぐ。

## テスト

- `output-scale.test.ts`: applyOutputScales / get/set / formatScale（既定不変・number 以外不適用・倍率×値・素通し）。
- `evaluator.test.ts`: 倍率なしで従来同値（回帰防止）・倍率適用・倍率1素通し・memo 反映。
- `serialize.test.ts`: round-trip 保持・不正値の除去・未設定は undefined。
- `duplicate.test.ts`: 複製で outputScales 引き継ぎ（深いコピー）。
- UI（チップ描画・クリック編集）は headless 困難のため手動確認。

## 手動確認項目

1. number 出力を持つノード（Number/Sine/Multiply 等）の出力行右端に倍率チップ「×1」が控えめに出る。
2. チップをクリック→数値入力→例 2 を commit すると「×2」が緑表示になり、下流の値が 2 倍になる（出力値デバッグ ON で確認）。
3. 1 に戻すとチップが控えめ表示に戻り、挙動が従来どおりになる。
4. undo/redo で倍率変更が戻る/やり直せる。
5. プロジェクト保存→再読込で倍率が保持される。
6. ノード複製で倍率が引き継がれる。
7. number 以外の出力（texture/audio/signal）にはチップが出ない。
