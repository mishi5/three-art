# #186 オートメーション記録/再生ノード（Automation）設計（再設計版）

対象 Issue: https://github.com/mishi5/three-art/issues/186

## 経緯（再設計の理由）

最初のバージョン（PR #268・未マージ）は、`arm`/`in` という 2 つの trigger/number **入力ポート**を
グラフに配線して録音を制御する設計だった。ユーザによる実機確認の結果、以下のフィードバックを受けて
**大きく作り替えた**。

- トリガーポート（arm/in）での記録開始/終了はやめ、**#204 TapSequencer と同じ「押している間だけ
  記録」のホールド録音**に変える。
- ただし記録トリガは「ノード上のボタン」ではなく、**物理キー 'r'（e.code === "KeyR"）を押している
  間**にする（TapSequencer は録音ボタンのホールドだが、Automation はノード上のボタンを持たない
  UI 割り切りにする）。
- **どのノードを記録するかは「現在選択中のノード」で判定**する（`NodeEditor.selectedIds` が単一
  選択で、かつそのノードが `Automation` のときだけ 'r' を捕捉する）。
- 記録元の値は入力ポート `in` ではなく、**他ノードから接続もでき、ノード上で直接ドラッグ操作も
  できる通常の number param `value`**（#74 の自動入力ポート化）にする。
- **`reset` トリガ入力は維持**する（再生位置を先頭へ戻す）。
- **シークバーを追加**する（ループの再生位置を可視化＋ドラッグで手動シークもできる）。
- **記録内容をクリアするボタン**も追加する。

TapSequencer 自体の 'r' キー化・シークバー追加は本 Issue の対象外（別 Issue）とし、
`nodes/TapSequencerNode.ts` / `nodes/tap-sequencer-logic.ts` は今回一切変更していない。

## 目的（スコープ 1+2 の MVP、再設計後）

ライブ中に手で動かした param（`value`）の**時間軌跡を記録**し、**ループ再生・重ね掛け**できる
新ノード `Automation`（category: `control`）を追加する。タイムラインのキーフレームとは別物で、
`#204 TapSequencer` と同じ「loop station 的なライブ演奏の録音」の系譜（trigger 版が
TapSequencer、number 軌跡版が Automation）。

- 単トラック記録 → ループ再生（YAML 永続化）。
- **loopMode 全種**（`once` / `loop` / `pingpong`）＋ `speed`（再生速度倍率）。
- **録音の長さは手動停止（可変長）**: ノードを選択して 'r' を押している間が記録区間、離した時点
  までがループ長になる（#204 と同じホールド録音の感覚）。
- **オーバーダブなし**（単トラック上書きのみ）: 再度 'r' で記録を始めると前の記録を破棄して
  新規記録（#204 の「playing 中の startRecording で前の記録を破棄」と同じ挙動）。
- **シークバー**でループ再生位置を可視化し、ドラッグでライブスクラブできる。
- **クリアボタン**で記録済みデータを消去し idle（未記録）へ戻せる。

## スコープ外（将来拡張）

- 複数トラック・オーバーダブ（重ね録り）。
- クオンタイズ / テンポ同期。
- TapSequencer 自体の 'r' キー化（別 Issue）。

## ノード定義

```
type: "Automation"
category: "control"
automation: true   // NodeEditor に専用 UI（シークバー/クリアボタン/ステータス行）を出す目印

inputs:
  reset (trigger) … 立ち上がりで再生位置を先頭へ戻す

outputs:
  out (number) … 再生中は記録値を補間、記録中・未記録時は value をパススルー

params:
  value               (number, kind:"number", default 0, step 0.01)
                      … 記録するソース値。noInput を付けない通常の number param なので
                        #74 により自動入力ポート化される（接続もドラッグ手動操作も両方できる）。
  loopMode            (enum: once/loop/pingpong, 既定 loop)
  speed               (number, 既定 1, 0.1..4)
  recordedFrames      (string kind・実体は配列、既定 [], noInput+hidden) … 永続化用
  recordedLoopLenSec  (number, 既定 0, noInput+hidden)                  … 永続化用
```

`arm`/`in` 入力ポートは削除した（旧バージョンから最大の変更点）。`value` は Number ノードの
`value`（noInput）とは異なり、EnvelopeNode の `attack`/`release` と同じ「noInput を付けない
number param」なので、他ノードからの配線と手動ドラッグの両方に対応する。

## 記録トリガ: NodeEditor の 'r' キー（ノード直付けボタンではない）

TapSequencer は「録音ボタンのホールド」だが、Automation は専用ボタンを持たず、**ノードを選択して
物理キー 'r' を押している間**を記録区間とする。

- `NodeEditor` に `selectedIds.size === 1` かつ選択中ノードの `def.automation === true` の
  ときだけ 'r' を捕捉する専用ハンドラ（`onAutomationKeyDown`/`onAutomationKeyUp`、capture フェーズ・
  `e.code === "KeyR"` で物理キー判定・`e.stopImmediatePropagation()`）を追加した。
  - keydown（`!e.repeat`）: `automationRecordingNodeId` が null なら記録開始
    （`automationRecordingNodeId = nodeId` → `onAutomationRecordStart?.(nodeId)`）。
  - keyup: `automationRecordingNodeId` があれば `onAutomationRecordStop?.(id)` して null に。
  - **一度記録が始まったら、途中で選択が変わっても keyup まで継続する**
    （TapSequencer と同じロック方式・selectedIds の変化を毎フレーム監視する複雑な仕組みは不要）。
  - ウィンドウ blur（フォーカス喪失）でも記録中なら停止処理を呼ぶ（#167/#204 と同じ堅牢性）。
  - INPUT/SELECT/TEXTAREA へのフォーカス中は 'r' を奪わない（テキスト入力を邪魔しない）。

## シークバー・クリアボタン（NodeEditor 描画/ヒット判定）

`editor/layout.ts` に TapSequencer 相当の純関数を追加した。

- `hasAutomationRows(def)` … `def.automation` を持つか。
- `automationSeekRowRect(node, def)` … シークバー行（params 直下）。
- `automationControlRowRect(node, def)` … クリアボタン＋ステータス行（シークバー行の直下）。
- `automationControlLayout(rect)` … コントロール行を「✕ クリア」ボタンとステータス表示に分割。
- `automationSeekFraction(rect, worldX)` … シークバー領域内の world x 座標 → fraction（0..1
  クランプ）の純関数。
- `automationStatusLabel(status)` … ステータス行の表示文言（recording/playing/idle）。

`NodeEditor.ts`:
- `onDown`: シークバー行クリックで即座に `onAutomationSeek?.(nodeId, fraction)` を呼び、
  ドラッグ種別 `automationSeek` を開始する。クリアボタンは `onAutomationClear?.(nodeId)`。
- `onMove`: `drag.kind === "automationSeek"` の間、pointer 位置から fraction を再計算し続けて
  `onAutomationSeek` を呼び続ける（ライブスクラブ）。
- `onUp`: `drag = null` にするだけ（値は onMove で反映済み）。
- 描画: シークバー（背景＋進捗の塗り。録音中は赤系の枠にして「今は録音中」だと分かるようにする）と、
  クリアボタン＋ステータス行（TapSequencer の `tapControlLayout`/`tapStatusLabel` と同じ描き方）。

新規 callback props: `onAutomationRecordStart`/`onAutomationRecordStop`/`onAutomationSeek`/
`onAutomationClear`/`automationInfo`（TapSequencer の `onTapRecordStart` 等と対になる命名）。

## 永続化方式: params 格納を維持（GraphDoc 変更なし）

再設計後も、記録データ（`recordedFrames`/`recordedLoopLenSec`）は既存の
`NodeInstance.params` に持たせる方式を維持している（旧バージョンからの変更なし）。

- `graph/serialize.ts` の `deserializeGraph` は `NodeInstance.params` を
  「既知 `ParamDef` にマージ（欠落は default）」という汎用ロジックで復元しており、
  `GraphDoc` 型・`serialize.ts` を一切変更せずに新しい永続データを乗せられる。
- 既に `MidiPadNode`（`padAssets: string[]`, kind: `"string"` だが実体は配列）という前例があり、
  本ノードの `recordedFrames: {t:number,v:number}[]` も同じ流儀に乗せられる。

`createState` は `env` のみを受け取り `NodeInstance` にアクセスできないため、復元は `evaluate` 側で
「初回のみ」行う（`AutomationRuntime.primed` フラグ）。録音確定時のみ `ctx.node.params` へ書き戻す
（`AutomationNode.evaluate` の `onCommit` コールバック）。

### History との関係

`ctx.node.params` への書き戻しは `evaluate`（毎フレームのランタイム評価ループ）内で直接オブジェクトを
変更するだけであり、`NodeEditor` の UI 操作経由の `History.record()` を一切通らない。そのため
「録音開始/クリア」も「毎フレームの playhead 進行」も History には記録されない
（TapSequencer もノード直付けの録音ボタンだが同様に History 非連動）。

## 純関数（`nodes/automation-logic.ts`）

DOM/時計に依存しない純関数のみを分離し、TDD で厚くテストする（`nodes/automation-logic.test.ts`）。

```ts
export type AutomationPhase = "idle" | "recording" | "playing";
export type LoopMode = "once" | "loop" | "pingpong";
export interface AutomationFrame { t: number; v: number }
export type ArmEdge = "start" | "stop" | "none";

/** armed（'r' キーのホールド状態）フラグの立ち上がり/立ち下がりエッジ判定。
 *  フェーズ遷移そのものは呼び出し側 Runtime の責務（#186 再設計で旧 armToggle から分離）。 */
export function armEdge(prevArmed: boolean, curArmed: boolean): ArmEdge;

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

`pushFrame`/`sampleAt`/`advancePlayhead`/`loopPosition`/`sanitizeFrames` は旧バージョンから
ロジック変更なし（妥当なため流用）。`armToggle`（trigger の立ち上がりからフェーズを直接返す関数）は
**`armEdge`（boolean armed のエッジ判定のみを返す関数）に置き換えた**。フェーズ遷移の判断
（recording への突入・0 フレーム時の idle 差し戻し等）は `AutomationRuntime.step` 側に集約した。

`advancePlayhead`/`loopPosition` を分けている理由は旧バージョンと同じ: pingpong の往復方向は
playhead の値だけからは一意に復元できないため、playhead 自体は「巻き戻さず加算し続ける累積値」として
保持し、`loopPosition` がその累積値を loopMode に応じてサンプリング用の位置へ変換する。

新規 `layout.ts` 側の純関数 `automationSeekFraction(rect, worldX)` はシークバーのヒット判定/
ドラッグ位置 → fraction 変換を担う（DOM 非依存・テスト容易）。

## 状態機械（`AutomationRuntime`、`nodes/AutomationNode.ts`）

```
startRecording()/stopRecording() は armed フラグの ON/OFF のみ（引数なし）。
実際のフェーズ遷移は step() が armEdge(prevArmed, armed) で検出して行う:

idle --armed立ち上がり--> recording --armed立ち下がり・frames非空--> playing
                          recording --armed立ち下がり・frames空-------> idle
playing --armed立ち上がり--> recording（前の記録を破棄）
任意 --reset(立ち上がり)--> playhead を先頭へ（フェーズは変えない）
```

TapSequencer との違い: TapSequencer の `startRecording(nowSec)`/`stopRecording(nowSec)` は
呼び出し側の wall clock を受け取り、その場でフェーズを確定させる（呼ばれた瞬間に録音開始/終了が
確定する）。Automation は **毎フレーム値をサンプリングする必要がある**ため、
`startRecording()`/`stopRecording()` は armed フラグを立てる/下ろすだけの薄い操作にし、
実際のフレーム記録・タイムスタンプ算出・確定判断は `step()` 内で `ctx.timeSec` を使った
armed のエッジ検出（`armEdge`）によって行う。これにより「'r' を押した瞬間」と「次に evaluate が
呼ばれるフレーム」の間にズレがあっても、記録開始時刻は必ず `evaluate` のフレーム時刻（`ctx.timeSec`）
基準になり、録音中の毎フレームサンプリングと矛盾しない。

- 記録中は `pushFrame(frames, t, value, MAX_FRAMES)` を毎フレーム実行（`t` は録音開始からの
  相対秒）。`MAX_FRAMES = 6000`（想定 60fps で約 100 秒ぶん・暴走防止の上限）。
- 録音確定時、`frames` が空 or 経過秒が 0 以下なら再生せず `idle` に戻す（#204
  `finalizeRecording` の「タップ 0 回は null」と同じガード）。
- 再生開始直後（録音確定でこのフレームに `playing` へ遷移した瞬間、および `reset` が
  発火したフレーム）は `dt=0` として扱う（TapSequencer の `playAnchorSec` と同じ考え方）。
- 出力（`step()` の戻り値）:
  - `recording` → `value` をそのままパススルー。
  - `playing` → `playhead` を `advancePlayhead` で進め、`loopPosition` で
    サンプリング位置に変換し、`sampleAt(frames, pos)` を返す。
  - `idle`（未記録）→ `value` をパススルー（記録前は素通しにして違和感を減らす）。

追加 API（再設計で新設）:

- `clear(): void` … frames/loopLenSec/phase/playhead をリセットして idle へ（再生停止）。
  クリアボタンから呼ばれる。
- `seekToFraction(frac: number): void` … `loopLenSec > 0` のときだけ
  `playhead = clamp(frac,0,1) * loopLenSec` に設定する（idle・loopLenSec<=0 は無視）。
  シークバードラッグから呼ばれる。

## main.ts 配線（duck-type）

```ts
type AutomationControl = {
  startRecording?: () => void;   // TapSeqControl と異なり引数なし
  stopRecording?: () => void;    // 同上
  clear?: () => void;
  seekToFraction?: (frac: number) => void;
  status?: () => { phase; frameCount; loopLenSec; playPosSec; recordElapsedSec };
};
editor.onAutomationRecordStart = (id) => (runtime.getState(id) as AutomationControl | undefined)?.startRecording?.();
editor.onAutomationRecordStop  = (id) => (runtime.getState(id) as AutomationControl | undefined)?.stopRecording?.();
editor.onAutomationClear       = (id) => (runtime.getState(id) as AutomationControl | undefined)?.clear?.();
editor.onAutomationSeek        = (id, frac) => (runtime.getState(id) as AutomationControl | undefined)?.seekToFraction?.(frac);
editor.automationInfo          = (id) => (runtime.getState(id) as AutomationControl | undefined)?.status?.();
```

## 変更ファイル

### 新規（変更なし・既存ファイル）
- `nodes/automation-logic.ts` … 純関数（`armEdge` に置き換え、他は流用）。
- `nodes/automation-logic.test.ts` … 純関数のユニットテスト。
- `nodes/AutomationNode.ts` … `AutomationRuntime`（状態機械の再設計）＋ `NodeTypeDef`。
- `nodes/AutomationNode.test.ts` … 定義・状態遷移（record開始→確定→再生→seek→clear・reset・
  loopMode 3種・pingpong 往復・オーバー録音での破棄）・evaluate のテスト。

### 変更
- `graph/node-type.ts` … `automation?: boolean` フラグを追加（`tapSequencer` と同じ形）。
- `editor/layout.ts` … `hasAutomationRows`/`automationSeekRowRect`/`automationControlRowRect`/
  `automationControlLayout`/`automationSeekFraction`/`automationStatusLabel` を新設。
  `nodeHeight` に automation 行ぶんの高さを追加。
- `editor/layout.test.ts` … 上記のテストを追加。
- `editor/NodeEditor.ts` … 'r' キー録音（`onAutomationKeyDown`/`onAutomationKeyUp`）、
  シークバードラッグ（`Drag` に `automationSeek` を追加）、クリアボタン、描画、
  新規 callback props（`onAutomationRecordStart`/`onAutomationRecordStop`/`onAutomationSeek`/
  `onAutomationClear`/`automationInfo`）、`onBlur` での録音停止を追加。
- `main.ts` … `AutomationControl` duck-type 配線を追加（TapSequencer 配線の直後）。
- `i18n-nodes.ts` … `node.Automation.port.in`/`port.arm` を削除し `param.value` を追加。
  `desc`/`port.reset`/`port.out` の文言を新仕様に更新。
- `i18n.ts` … `node.automation.none`/`recording`/`playing`/`clearBtn` を追加
  （`node.tap.*` と対になる命名）。
- `nodes/registry.ts` … 変更なし（既に `AutomationNode` を登録済み）。

`graph/serialize.ts` は変更不要（上記「永続化方式」参照）。

## 手動確認手順（例）

1. `Automation` ノードを追加し、ノードをクリックして選択する（`selectedIds.size === 1`）。
2. 物理キー 'r' をホールドしたまま、`value` param 行を数秒ドラッグして手動で動かす
   （記録トリガはノード上のボタンではなく、選択中の 'r' ホールドであることを確認）。
3. 'r' を離す → 録音が確定し、ループ再生が始まる（ステータス行が recording→playing に変わる）。
4. `Automation.out` を適当な可視化 param（例: `PointShape` の scale 等）へ接続し、
   記録した軌跡どおりループ再生されることを確認する。
5. シークバーをドラッグし、再生位置がライブに変わることを確認する（ライブスクラブ）。
6. `loopMode` を `pingpong`/`once` に切り替え、往復再生・末尾停止を確認する。
7. `reset` トリガ（他ノードから配線）を発火し、再生位置が先頭に戻ることを確認する。
8. クリアボタンを押し、記録が消えて未記録（idle）に戻ることを確認する。
9. 再度 'r' ホールドで記録 → 離す → プロジェクトを保存 → 再読込し、記録済みの軌跡が
   再生され続けることを確認する（`recordedFrames`/`recordedLoopLenSec` の永続化）。
