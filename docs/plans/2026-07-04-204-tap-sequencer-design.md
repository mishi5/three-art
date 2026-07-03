# #204 スペースキー入力シーケンス記録ノード（TapSequencer）設計

対象 Issue: https://github.com/mishi5/three-art/issues/204

## 目的（MVP）

スペースキーで手打ちしたタイミング列を記録し、その記録に従って trigger を自動発火（末尾でループ）する
新ノード `TapSequencer`（category: "generator"・Pulse と同じ trigger 生成系）を追加する。

- **ホールド録音**: ノード上の「● 録音」ボタンを**押しているあいだだけ**記録し、離したら停止（ルーパーのイメージ）。
  **ループ長＝ボタンを押していた時間**（最後の一打の後の「間」も保持され、グルーヴが保てる）。
- 録音中: スペースキー（**e.code === "Space"** の物理キー判定・#167 と同じ理由で e.key は使わない）を
  押すたび、押下時刻（録音開始からの相対秒）を記録。**録音中のタップも即座に trigger を発火**（手応え）。
- 録音終了後: 記録したタイミング列に従い trigger を発火し、ループ長で wrap してループ再生。
- クリア（記録消去・再生停止）／再録音（ホールドし直したら前の記録を破棄して新規記録）。
- 記録が空（タップ 0 回）なら再生しない（idle に戻る）。
- trigger の発火表現は既存（Pulse/FlipFlop/MidiPad）と同じ「1 フレームだけ true」の boolean。

## スコープ外（将来拡張）

- **記録列（taps/loopLen）の params への永続化**（プロジェクト保存・リロード復元）。当面は揮発でよい。
  対応する場合は `params.taps: number[]`（hidden・noInput）＋ `params.loopLen: number` に確定時書き込み、
  createState 後の復元フックで Runtime へ流し込む形を想定。
- クオンタイズ / テンポ同期 / 複数トラック / MIDI 入力での打鍵。
- 拡大オーバーレイ UI（MidiPad の ⛶ 相当）。

## ノード定義

- type: `TapSequencer` / category: `generator`
- inputs: なし / outputs: `trigger`（trigger ×1）/ params: なし
- `NodeTypeDef.tapSequencer?: boolean` を目印フラグとして追加（padGrid / randomButton と同じ流儀）。

## 変更ファイル

### 新規
- `nodes/tap-sequencer-logic.ts`: 純ロジック（下記 API）。
- `nodes/tap-sequencer-logic.test.ts`: 純関数のユニットテスト（記録確定・wrap 跨ぎ・長 dt）。
- `nodes/TapSequencerNode.ts`: `TapSequencerRuntime`（状態機械 idle→recording→playing）＋ `NodeTypeDef`。
- `nodes/TapSequencerNode.test.ts`: 定義・状態遷移・evaluate（録音中即時発火／再生発火）のテスト。

### 変更
- `graph/node-type.ts`: `NodeTypeDef` に `tapSequencer?: boolean` を追加。
- `editor/layout.ts`: `hasTapRows` / `tapControlRowRect`（録音＋クリアの 2 ボタン行）/
  `tapStatusRowRect`（ステータス行）/ `tapControlLayout` / `tapStatusLabel` を追加。
  `nodeHeight` に 2 行ぶん加算。
- `editor/layout.test.ts`: 上記幾何・ラベルのテスト。
- `editor/NodeEditor.ts`:
  - Drag に `{ kind: "tapRecord"; nodeId }` を追加。録音ボタン pointerdown で録音開始＋この drag を張り、
    pointerup（onUp）で録音停止。trackpad の pointerup 欠落は既存の `onMove` の `buttons===0` フォールバック
    （#167）が onUp を呼ぶため自然に停止する。window blur でも停止。
  - **capture フェーズの keydown** を window に張り、`drag.kind==="tapRecord"` のときだけ
    `e.code==="Space"` を消費（preventDefault＋stopImmediatePropagation で #167 の Space パンへ流さない・
    `e.repeat` は無視）。録音していない時はグローバルキーを一切奪わない。
  - 公開コールバック `onTapRecordStart` / `onTapRecordStop` / `onTap` / `onTapClear` / `tapSeqInfo` を追加。
  - drawNode: 録音ボタン（録音中は赤く点灯）・クリアボタン・ステータス行（記録数/ループ長/再生位置）。
- `nodes/registry.ts`: `TapSequencerNode` を generator 群（RandomValue の後）に登録。
- `main.ts`: duck-type `TapSeqControl` で Runtime の `startRecording/stopRecording/tap/clear/status` を配線。
  時刻源は `performance.now()/1000`（録音はすべて相対秒＝クロック差は問題にならない）。

## 純関数 API（nodes/tap-sequencer-logic.ts）

```ts
export type TapSeqPhase = "idle" | "recording" | "playing";

/** 録音確定。taps を [0, loopLen) に正規化（防御的に wrap）・昇順ソート。
 *  タップ 0 回 or loopLen<=0 は null（再生しない）。 */
export function finalizeRecording(
  pressTimesSec: readonly number[], loopLenSec: number,
): { taps: number[]; loopLenSec: number } | null;

/** 再生経過秒の半開区間 [prevSec, curSec) に発火すべきタップがあるか。
 *  ループ wrap 跨ぎ・ループ長より長い dt（>=1 周は無条件 true）でも破綻しない。
 *  dt<=0 は false。連続フレームの区間は互いに素なので二重発火しない。 */
export function firedBetween(
  prevSec: number, curSec: number, taps: readonly number[], loopLenSec: number,
): boolean;

/** 再生経過秒 → ループ内位置（0..loopLen）。表示用。 */
export function playPositionSec(elapsedSec: number, loopLenSec: number): number;
```

## 状態機械（TapSequencerRuntime）

```
idle --startRecording--> recording --stopRecording(タップあり)--> playing
                         recording --stopRecording(タップ 0)---> idle
playing --startRecording--> recording（前の記録を破棄）
任意 --clear--> idle
```

- 録音時刻は呼び出し側から渡す `nowSec`（wall clock）。保持するのは相対秒のみ。
- 再生の時刻基準は `evaluate` の `ctx.timeSec`。playing 遷移直後の最初の evaluate で
  `playAnchorSec = ctx.timeSec` を張り、以後 `firedBetween(prev, cur)`（anchor 相対・半開区間）で判定。
  アンカー直後のフレームは prev=0 なので t=0 のタップも取りこぼさない。
- 録音中タップは `pressed` ラッチ → evaluate の `consumeTapTrigger()` で 1 フレーム発火（MidiPad と同じ）。
- `status(nowSec?)` が UI 表示用の `{ phase, tapCount, loopLenSec, playPosSec, recordElapsedSec }` を返す。
