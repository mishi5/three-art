# #150 Number ノードにランダムボタンを追加

対象 Issue: https://github.com/mishi5/three-art/issues/150
親 Epic: #56

## 目的
Number ノードに、value をランダム生成するボタンを追加する。範囲（min/max）を指定でき、
クリックで再ロールできる。

## 設計
- `NodeTypeDef` に汎用フラグ `randomButton?: { paramId: string }` を追加。
- `NumberNode`: `min`(既定0) / `max`(既定1) param を追加（number・noInput）。`randomButton: { paramId: "value" }`。
- 純関数 `editor/random-value.ts` の `randomInRange(min, max, rand)`（min>max は入替・rand 線形補間）。
- `editor/layout.ts`:
  - `hasRandomRow(def)` / `nodeHeight` に1行加算 / `randomRowRect(node, def)`（params 直下の行）。
- `editor/NodeEditor.ts`:
  - mousedown（node ヒット時）: randomRowRect 内なら `history.record` → `value` を
    `randomInRange(min, max, Math.random())`（小数3桁丸め）に再ロール。
  - drawNode: 「🎲 ランダム」ボタン行を描画。

## テスト
- `random-value.test.ts`: randomInRange の境界・入替・同値。
- `number-node.test.ts`: value/min/max param・randomButton・evaluate。
- `layout.test.ts`: hasRandomRow / nodeHeight / randomRowRect。
- `serialize.test.ts`: Number の正準 params に min/max を反映（round-trip 同値）。
- クリック→再ロールの結線は Playwright スモークで確認（値変化＋伝播・ボタン描画）。

## 成果物
- `NumberNode.ts` / `node-type.ts` / `editor/random-value.ts` / `editor/layout.ts` / `editor/NodeEditor.ts`
- テスト追加・更新。全727件パス。
