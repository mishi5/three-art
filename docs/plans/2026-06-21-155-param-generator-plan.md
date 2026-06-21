# #155 パラメータジェネレータノード（onset 定期出力・ランダム値）

対象 Issue: https://github.com/mishi5/three-art/issues/155
親 Epic: #56

## 目的
パラメータ（数値/トリガー）を生成するジェネレータを追加する。
1. 一定間隔で trigger を定期発火するノード。
2. ランダム値を出力するノード（trigger/interval で再ロール）。

## 設計（2ノード）
- 出力型が異なる（trigger / number）ため 2 ノードに分割。組み合わせて
  「Pulse の拍で RandomValue を再ロール」が作れる（Issue の「トリガーで再ロール」）。
- どちらも category=`generator`（number/trigger を出す上流ソース。Number/Time と同じ括り）。

### PulseNode
- 入力なし、`trigger` 出力。param: `interval`（秒）。
- state `PulseRuntime { lastFire, primed }`。起動時刻基準で interval 経過ごとに 1 フレーム発火。

### RandomValueNode
- `trigger` 入力（任意）、`out`(number) 出力。param: `min` / `max` / `interval`（0=自動なし）。
- state `RandomValueRuntime { value, lastFire, prevTrig, primed }`。
- trigger 立ち上がり or interval 経過で `min〜max` のランダム値に再ロール。

### 純粋ロジック（param-gen-logic.ts）
- `pulseStep(now, lastFire, interval)` → { fired, lastFire }
- `rerollDue(now, lastFire, interval)`（interval<=0 は false）
- `randomRange(min, max, rand)`（min>max 入替・線形補間）

## テスト
- `param-generator.test.ts`: 純関数 3 種 + 両ノードの定義 + state ありの evaluate
  （Pulse の interval 発火 / RandomValue の trigger 再ロール・範囲）+ registry 登録。
- 全743件パス。Playwright スモークで Pulse→RandomValue→TextureGenerator(色)→Screen の
  チェーンが評価・描画されることを確認（RandomValue が color1 R を駆動）。

## 成果物
- `nodes/PulseNode.ts` / `nodes/RandomValueNode.ts` / `nodes/param-gen-logic.ts`（新規）・registry 登録・テスト。
