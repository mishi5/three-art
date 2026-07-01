# #213 起動時シーン復元の未知ノード型サニタイズ 設計

Issue: https://github.com/mishi5/three-art/issues/213

## 背景 / 問題

起動時のシーン自動復元は `scene/scene-store.ts` の `load()` が `JSON.parse` で生の
`SceneSet` を返すだけで、各シーンの GraphDoc をサニタイズしない。そのため現ビルドに
存在しないノード型を含むシーンを復元すると、評価器 `graph/evaluator.ts` の
`registry.require()` が throw し、tick ループごとクラッシュする。localStorage が汚染
されているため、一度この状態になると毎回クラッシュし、手動でストレージをクリアする
まで復帰できない。

一方でインポート経路（`graph/serialize.ts deserializeGraph` /
`scene/project-file.ts deserializeProject`）は未知ノード/不正接続を捨てるガードを
既に持っている。復元経路だけがこのガードを通っていない。

## 方針（2 層防御）

### 層1: 復元時サニタイズ（純関数）

`scene/scene-sanitize.ts` に純関数 `sanitizeSceneSet(set, registry)` を新設する。
各シーンの GraphDoc を既存の `serializeGraph → deserializeGraph`（`graph/serialize.ts`）
に通して未知ノード/不正接続/未知 param を除去し、健全化した SceneSet と warnings を返す。
project-file.ts の `deserializeProject` と同じ再検証パターンを踏襲する。

- graph 再検証に失敗（version 不一致等）したシーンは空グラフ（`createGraph()`）で再生成し warning。
- scenes が全滅した場合は `null` を返す（呼び出し側は既定シーンへフォールバック）。
- activeId が生存シーンに無ければ先頭へフォールバック、outputId 不在は null。

`main.ts` の savedSceneSet 復元経路（L351 付近）で `sceneStore.load()` の直後に
`sanitizeSceneSet` を通してから `SceneManager` へ渡す。warnings は console.warn で通知。

### 層2: 評価器の防御（多層防御）

`graph/evaluator.ts` の `evalNode` で `registry.require(node.type)` を
`registry.get(node.type)` に置き換え、未登録ノードは評価をスキップ（空の出力
`{}` を返す）する。これにより層1 をすり抜けた未知ノードが残っても tick ループが
クラッシュしない。`getSinks` は既に `registry.get` を使用済み。

## テスト

- `scene/scene-sanitize.test.ts`: 未知ノードを含む SceneSet → 除去後・warning 収集、
  正常シーンは不変、activeId/outputId フォールバック、全滅で null。
- `graph/evaluator.test.ts`: 未知 type ノードをスキップし throw しない。

## 変更ファイル

- 新規: `scene/scene-sanitize.ts`, `scene/scene-sanitize.test.ts`
- 変更: `main.ts`（復元経路にサニタイズ挿入）, `graph/evaluator.ts`（require→get+skip）
- 変更: `graph/evaluator.test.ts`（未知ノードスキップのテスト追加）
