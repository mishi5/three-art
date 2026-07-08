# #186 オートメーション記録/再生ノード（Automation）設計

対象 Issue: https://github.com/mishi5/three-art/issues/186

## 目的（スコープ 1+2 の MVP）

ライブ中に手で動かした param の**時間軌跡を記録**し、**ループ再生・重ね掛け**できる
新ノード `Automation`（category: `control`）を追加する。タイムラインのキーフレームとは別物で、
`#204 TapSequencer` と同じ「loop station 的なライブ演奏の録音」の系譜（trigger 版が
TapSequencer、number 軌跡版が Automation）。

- 単トラック記録 → ループ再生（YAML 永続化）。
- **loopMode 全種**（`once` / `loop` / `pingpong`）＋ `speed`（再生速度倍率）。
- **録音の長さは手動停止（可変長）**: `arm` の立ち上がりエッジで録音開始、もう一度 `arm` の
  立ち上がりエッジで停止した時点までがループ長になる（#204 と同じホールド/トグル録音の感覚）。
- **オーバーダブなし**（単トラック上書きのみ）: 再 arm すると前の記録を破棄して新規記録
  （#204 の「playing 中の startRecording で前の記録を破棄」と同じ挙動）。

## スコープ外（将来拡張）

- 複数トラック・オーバーダブ（重ね録り）。
- クオンタイズ / テンポ同期。
- ノード上の専用録音 UI（TapSequencer の「● 録音」ボタン相当）。本ノードの `arm`/`reset` は
  **グラフの trigger 入力**（他ノードからの配線）であり、TapSequencer のようなノード直付けの
  UI ボタンではない。そのため `editor/layout.ts` / `NodeEditor.ts` の変更は不要（後述）。

## ノード定義

```
type: "Automation"
category: "control"

inputs:
  in    (number)  … 記録するソース値
  arm   (trigger) … 記録開始/確定のトグル（立ち上がりエッジ）
  reset (trigger) … 再生位置を先頭へ戻す（立ち上がりエッジ）

outputs:
  out (number) … 再生中は記録値を補間、記録中・未記録時は in をパススルー

params:
  loopMode (enum: once/loop/pingpong, 既定 loop)
  speed    (number, 既定 1, 0.1..4)
  recordedFrames      (string kind・実体は配列、既定 [], noInput+hidden) … 永続化用
  recordedLoopLenSec  (number, 既定 0, noInput+hidden)                  … 永続化用
```

`arm`/`reset` はグラフ上の trigger 入力なので、TapSequencer のようなノード直付けの
録音ボタン UI は不要。ライブ演奏時は MidiPad や別の TapSequencer/Pulse などから
`arm`/`reset` へ配線して操作する想定（「手で動かした param」は `in` へ配線した
Number の🎲やUI操作、あるいは他ノード出力）。

## 永続化方式の決定: params 格納を採用（GraphDoc 変更なし）

Issue 本文には `GraphDoc.automationTracks` へ保存する案が示されていたが、以下の理由で
**既存の `NodeInstance.params` に記録済み frames を持たせる方式**を採用した。

- `graph/serialize.ts` の `deserializeGraph` は `NodeInstance.params` を
  「既知 `ParamDef` にマージ（欠落は default）」という汎用ロジックで復元しており、
  `GraphDoc` 型・`serialize.ts` を一切変更せずに新しい永続データを乗せられる。
- 既に `MidiPadNode`（`padAssets: string[]`, kind: `"string"` だが実体は配列）という
  「ParamDef.kind は簡略表現・実体は JSON 可能な複合値」の前例があり、本ノードの
  `recordedFrames: {t:number,v:number}[]` も同じ流儀に乗せられる（`kind: "string"`,
  `default: []`, `noInput: true`, `hidden: true` でノード UI には出さない）。
- `GraphDoc.automationTracks` を新設する案は、型定義・serialize・deserialize・
  シーン複製/削除（シーンごとに保持するか等）の考慮が新たに必要になり変更範囲が広い。
  params 格納なら「このノードのインスタンスが持つ状態」として既存のノード複製・削除・
  シーン切替の仕組みにそのまま乗る（GraphDoc 側の特別扱いが不要）。

よって **params 格納方式を採用**。`createState` は `env` のみを受け取り `NodeInstance` に
アクセスできないため、復元は `evaluate` 側で「初回のみ」行う（`AutomationRuntime.primed`
フラグ・FlipFlop/Pulse の `primed` と同じパターン）。録音確定時のみ `ctx.node.params` へ
書き戻す（`AutomationNode.evaluate` の `onCommit` コールバック）。

### History との関係

`ctx.node.params` への書き戻しは `evaluate`（毎フレームのランタイム評価ループ）内で直接
オブジェクトを変更するだけであり、`NodeEditor` の UI 操作経由の `History.record()` を
一切通らない。そのため「録音開始/クリア」も「毎フレームの playhead 進行」も History には
記録されない（Issue の「History は録音開始/クリアのみ記録」という要求を、実装上は
「エディタの明示操作を経由しないので何も記録しない」という形で自然に満たす。
TapSequencer もノード直付けの録音ボタンだが同様に History 非連動）。

## 純関数（`nodes/automation-logic.ts`）

DOM/時計に依存しない純関数のみを分離し、TDD で厚くテストする
（`nodes/automation-logic.test.ts`、28 ケース）。

```ts
export type AutomationPhase = "idle" | "recording" | "playing";
export type LoopMode = "once" | "loop" | "pingpong";
export interface AutomationFrame { t: number; v: number }

/** arm の立ち上がりエッジ判定＋暫定フェーズ遷移。
 *  recording への確定判断（frames 0件→idleに戻すか）は呼び出し側 Runtime の責務。 */
export function armToggle(prevArm: boolean, curArm: boolean, phase: AutomationPhase): AutomationPhase;

/** リングバッファへ 1 フレーム push（#217 pushSample 相当・上限で古い方から破棄）。 */
export function pushFrame(frames: AutomationFrame[], t: number, v: number, maxFrames: number): void;

/** 記録列（t 昇順）と時刻 t から線形補間値を返す。0/1 件・範囲外クランプに対応。 */
export function sampleAt(frames: readonly AutomationFrame[], t: number): number;

/** playhead を dtSec*speed ぶん進める。loop/pingpong は加算し続け（wrap しない）、
 *  once は [0, loopLenSec] にクランプして末尾で停止する。 */
export function advancePlayhead(
  playhead: number, dtSec: number, loopLenSec: number, loopMode: LoopMode, speed: number,
): number;

/** 累積 playhead → ループ内サンプリング位置。loop=modulo wrap／pingpong=三角波で往復／
 *  once=クランプ。 */
export function loopPosition(playhead: number, loopLenSec: number, loopMode: LoopMode): number;

/** params.recordedFrames（unknown・改ざん/旧形式の可能性）を安全な AutomationFrame[] へ
 *  検証・変換する（t/v とも有限数値のみ採用・t 昇順に整列）。 */
export function sanitizeFrames(raw: unknown): AutomationFrame[];
```

`advancePlayhead`/`loopPosition` を分けた理由: pingpong の往復方向は playhead の値
（例えば `loopLenSec` の途中の値）だけからは一意に復元できない（往路か復路か曖昧）。
そこで playhead 自体は「巻き戻さず加算し続ける累積値」として保持し（loop/pingpongでは
wrap しない）、`loopPosition` がその累積値を loopMode に応じてサンプリング用の位置
（`[0, loopLenSec]`）へ変換する。この分離により往復方向を保持するための余分な state
（方向フラグ等）が不要になる。

## 状態機械（`AutomationRuntime`、`nodes/AutomationNode.ts`）

```
idle --arm(立ち上がり)--> recording --arm(立ち上がり・frames非空)--> playing
                          recording --arm(立ち上がり・frames空)-----> idle
playing --arm(立ち上がり)--> recording（前の記録を破棄）
任意 --reset(立ち上がり)--> playhead を先頭へ（フェーズは変えない）
```

- `arm`/`reset` はいずれも `EvalContext.input()` から読む graph の trigger 値。エッジ検出は
  `evaluate` 呼び出し間で保持する `prevArm`/`prevReset` で行う（FlipFlop/Envelope と同じ
  「立ち上がりエッジ」表現）。
- 録音中は `pushFrame(frames, t, in値, MAX_FRAMES)` を毎フレーム実行（`t` は録音開始からの
  相対秒）。`MAX_FRAMES = 6000`（想定 60fps で約 100 秒ぶん・暴走防止の上限）。
- 録音確定時、`frames` が空 or 経過秒が 0 以下なら再生せず `idle` に戻す（#204
  `finalizeRecording` の「タップ 0 回は null」と同じガード）。
- 再生開始直後（録音確定でこのフレームに `playing` へ遷移した瞬間、および `reset` が
  発火したフレーム）は `dt=0` として扱う。理由: `dt` は前回 evaluate からの経過秒であり、
  録音中に経過した時間や reset 前の経過時間を含むため、そのまま playhead に加算すると
  再生開始位置が意図せず先読みされてしまう（TapSequencer の `playAnchorSec`＝
  「遷移直後のフレームは発火判定しない」と同じ考え方）。
- 出力（`step()` の戻り値）:
  - `recording` → `in` をそのままパススルー。
  - `playing` → `playhead` を `advancePlayhead` で進め、`loopPosition` で
    サンプリング位置に変換し、`sampleAt(frames, pos)` を返す。
  - `idle`（未記録）→ `in` をパススルー（記録前は素通しにして違和感を減らす）。

## 変更ファイル

### 新規
- `nodes/automation-logic.ts` … 上記純関数。
- `nodes/automation-logic.test.ts` … 純関数のユニットテスト（28 ケース）。
- `nodes/AutomationNode.ts` … `AutomationRuntime`（状態機械）＋ `NodeTypeDef`。
- `nodes/AutomationNode.test.ts` … 定義・状態遷移・evaluate（永続化復元・once 停止等）の
  テスト（15 ケース）。

### 変更
- `nodes/registry.ts` … `AutomationNode` を control 群（TapSequencer の直後）に登録。
- `i18n-nodes.ts` … `node.Automation.desc` / `port.{in,arm,reset,out}` /
  `param.{loopMode,speed,recordedFrames,recordedLoopLenSec}` を追加（#254 キー化カタログ）。

`graph/node-type.ts` / `graph/serialize.ts` は変更不要（上記「永続化方式の決定」参照）。
`editor/layout.ts` / `editor/NodeEditor.ts` も変更不要（専用 UI を持たない標準ノードのため）。

## 手動確認手順（例）

1. `Number`（value を時間で動かせるよう🎲や手動スライダで操作）→ `Automation.in` へ接続。
2. `Pulse` や `MidiPad` の trigger 出力 → `Automation.arm` へ接続。
3. `Automation.out` → 適当な可視化 param（例: `PointShape` の scale 等）へ接続。
4. arm を 1 回発火（録音開始）→ 数秒のあいだ `Number` を動かす → arm をもう一度発火
   （録音確定）。
5. `out` に接続した param が記録した軌跡どおりにループ再生されることを確認。
6. `loopMode` を `pingpong`/`once` に切り替え、往復再生・末尾停止を確認。
7. `reset` トリガを発火し、再生位置が先頭に戻ることを確認。
8. プロジェクトを保存 → 再読込し、記録済みの軌跡が再生され続けることを確認
   （`recordedFrames`/`recordedLoopLenSec` の永続化）。
