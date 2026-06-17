# #111 Flip-flop / Toggle ノード（trigger でオン/オフ反転）

対象 Issue: https://github.com/mishi5/three-art/issues/111

親 Epic: #56 / 前提: #110（Envelope, trigger 入力の作法）

## 目的
`onset` 等の trigger を受け、発火のたびに出力を 0↔1 で反転する process ノード（点滅・モード/A-B 切替）。

## 仕様
- 入力: `trigger`。出力: `number`（0 or 1）。param: `initial`（enum off/on, 既定 off）。
- 挙動: trigger の**立ち上がりエッジ**（false→true）でのみ反転。非発火フレームは現状態を維持。
- 初期状態は `initial` を最初の評価時に適用（`primed` フラグ）。状態はノードの永続 state に保持。

## 実装
- `FlipFlopNode`（category: process）。`FlipFlopRuntime { value:0|1; prevTrigger:false; primed:false }`。
- evaluate: 未 primed なら initial(off=0/on=1) で value 初期化。立ち上がりエッジで value=1-value。出力 { out: value }。
- エッジ検出は #110 Envelope と同様（連続 true で多重反転しない）。

## TDD
- ノード定義（trigger 入力 / number 出力 / initial param）。
- フレーム駆動: 発火で 0→1→0 と反転、非発火で維持、立ち上がりエッジのみ反転、initial=on で 1 始まり。
- state 無しは 0。
- 実 GPU 不要（純ロジック）。動作確認は onset→FlipFlop→任意 param を手動。

## 影響
- 既存変更なし。registry の process 群に登録。
