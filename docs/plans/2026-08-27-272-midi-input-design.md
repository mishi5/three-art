# #272 Web MIDI 入力ブリッジノード 設計

対象 Issue: https://github.com/mishi5/three-art/issues/272

## 概要

実機 MIDI コントローラ（ノブ/フェーダー/パッド）の入力を node-vj のグラフへ流し込む。
param が既に入力ポート化されている（#74）ため、MIDI → number/trigger のブリッジノードを
作れば任意の param へ配線できる。

- **新規ノード 4 種**: `MidiCC`（CC → number）／`MidiNote`（note → trigger/gate/velocity）／
  `MidiPad`（4×4 パッド → index/trigger/velocity）／`TriggerRouter`（index → 個別 trigger 分配）
- **既存ノードの拡張**: `SamplePad` / `ClipLauncher` に `padIndex` + `padTrig` 入力を追加し、
  実機パッドから既存のパッドを叩けるようにする
- **MIDI Learn**: ノード上の LEARN ボタンで ch / 番号を自動割当（param へ書き戻し・YAML 永続化に乗る）
- **OSC は対象外**（別 Issue）。ただしブリッジ層のイベント型を MIDI 非依存にして後から差し込める形にする

## 全体構造

Web MIDI の受信は 1 箇所に集約し、ノードはそこから読むだけにする。`SharedCamera`
（`nodes/shared-camera.ts`）と同じ「モジュール単一資源」の流儀。

```
Web MIDI API ──▶ SharedMidi ──▶ ControlBus ──▶ MidiCC / MidiNote / MidiPad
(requestMIDIAccess)  (接続管理)   (正規化状態の保持)
                                      ▲
                             （将来）OSC over WebSocket
```

### 正規化イベント（midi/midi-message.ts）

MIDI 固有ではない形にしておく。OSC を足すときは「OSC アドレス → この型」のアダプタを
1 つ書いて同じ `ControlBus` に流すだけで、ノード側は無改造で動く。

```ts
export type ControlEvent =
  | { kind: "cc";   channel: number; number: number; value: number }               // value 0..1
  | { kind: "note"; channel: number; number: number; on: boolean; velocity: number }; // 0..1
```

`parseMidiMessage(data)` は Web MIDI のバイト列を上記へ変換する純関数。

- `channel` は **1..16**（UI 表示と一致させる。0 は omni＝全 ch を意味する予約値として param 側で使う）
- 0xB0 = Control Change、0x90 = Note On、0x80 = Note Off。**velocity 0 の Note On は Note Off 扱い**
  （MIDI の慣習。多くのコントローラが離鍵をこの形で送る）
- ピッチベンド・アフタータッチ・MIDI クロック（0xF8）等は `null`（今回は扱わない）
- データ長不足・status バイト無し（ランニングステータス）は `null`。Web MIDI は常に status 付きで
  届くため、ランニングステータスに対応する必要はない

## 非同期入力とフレーム同期の橋渡し（midi/control-bus.ts）

MIDI イベントは非同期に届くが `evaluate` は毎フレーム同期で回る。`ControlBus` は
**コールバックを持たず、状態を保持してノードがポーリングする**設計にする。evaluate の
実行モデルとそのまま噛み合い、テストも同期的に書ける。

```ts
class ControlBus {
  emit(ev: ControlEvent): void
  currentSeq(): number
  lastEvent(): { ev: ControlEvent; seq: number } | null   // learn 用
  cc(channel: number, number: number): { value: number; seq: number } | undefined
  note(channel: number, number: number):
    { gate: boolean; velocity: number; onCount: number; lastOnSeq: number } | undefined
  reset(): void
}
```

**trigger にラッチ（消費して消える方式）を使わない。** `SamplePad` の `consumeTrigger()` は
1 ノードが自分の押下を消費する形なので成立するが、`ControlBus` は複数ノードが同じ note を
購読しうる。ラッチにすると最初に読んだ 1 ノードだけが発火する。

代わりに **note-on の累積回数 `onCount`** を持たせ、各ノードの runtime が前フレームの
`onCount` を覚えて差分が出たら発火する。これで

- 同じ note を複数ノードが受けても、それぞれ独立に発火する
- 1 フレームに 2 回叩かれても差分 > 0 で取りこぼさない（連打で消えない）

**omni（channel 0）** は emit の時点で「ch 別」と「ch=0」の両方へ書き込む。読む側は
キーを作るだけでよく、omni の分岐がロジックから消える。

**`lastOnSeq`** は全イベント通番。`MidiPad` が「差分が出たパッドのうち最後に押されたもの」を
`index` 出力に選ぶために使う。

## MIDI 接続管理（midi/shared-midi.ts）

唯一の DOM/Web MIDI 依存。最初の Midi 系ノードが評価されたときに冪等に起動する
（`SharedCamera.start()` と同じ多重呼び出し防止）。

- `requestMIDIAccess({ sysex: false })` — sysex は不要で権限が重くなるだけなので要求しない
- 全入力ポートの `onmidimessage` を購読し、`parseMidiMessage` → `bus.emit`
- `access.onstatechange` でデバイスの抜き差しに追従（新規ポートへ購読を張り直す）。
  ライブ中にケーブルが抜けても再接続で復帰する
- ステータス: `idle` / `unsupported`（`navigator.requestMIDIAccess` 無し）/ `denied`（権限拒否）/
  `no-device`（接続 0）/ `ready`。いずれも例外にせずステータス行に出し、ノードは既定値を出し続ける。
  **`no-device` の判定は `inputs.size` ではなく `state === "connected"` の数で行う**（切断済みポートは
  `inputs` に残り続けるため、数だけで見ると BLE MIDI が切れた後も「デバイスあり」のままになり、
  ステータス行に割当が出続けて「合っているのに効かない」状態になる）
- **ノードの `disposeState` では止めない**。シーン切替で MIDI が切れないように、`SharedCamera` と同じ扱い

## ノード仕様

4 種とも Learn 対象ノードには `midiLearn: true` を立てる。

### MidiCC（category: source）

ノブ/フェーダー 1 本を number にする。

| | |
|---|---|
| 出力 | `value`（number） |
| param | `channel`（int 0..16、0=omni）／`cc`（int 0..127）／`min`／`max` |

`value` は受信値 0..1 を `min`..`max` へ写像する。未受信なら `min` を出す。

平滑化 param は**持たない**。MIDI CC は 7bit（128 段階）で値が階段状になるが、既存の
`SmoothNode` を後段に繋げば済む。

### MidiNote（category: source）

パッド/鍵盤 1 つを trigger にする。

| | |
|---|---|
| 出力 | `trigger`（押下フレームに 1 回）／`gate`（number、押下中 1）／`velocity`（number 0..1） |
| param | `channel`（int 0..16）／`note`（int 0..127） |

### MidiPad（category: source）

4×4 の実機パッドを 1 ノードで受ける。`baseNote` から 16 個連番で拾う。

| | |
|---|---|
| 出力 | `index`（number 0..15、最後に押されたパッド）／`trigger`／`velocity` |
| param | `channel`（int 0..16）／`baseNote`（int 0..112、既定 36） |

既定 36 は GM ドラムの C1 で、多くのパッドコントローラの左上パッドの初期値。

ノード本体に 4×4 のインジケータを描き、押下中のパッドを光らせる（`midiPad: true` マーカー）。
既存の `padGrid` はファイル割当前提（クリックでダイアログ・Stop/拡大ボタン付き）で意味が違うため
流用せず、別マーカーにする。

**16 本の個別 trigger は持たせない。** ポートが 18 本に膨れてノードが縦に伸びる割に、
`TriggerRouter` を挟めば同じことができる。

### TriggerRouter（category: control）

index を受けて対応する 1 本の trigger だけを発火させる分配ノード（デマルチプレクサ）。
MIDI 専用ではなく、`TapSequencer` や `BeatClock` の出力を分配する用途にも使える。

| | |
|---|---|
| 入力 | `index`（number）／`trig`（trigger） |
| 出力 | `t1`..`t16`（trigger） |
| param | `offset`（int、既定 0） |

- 振り分け先は `round(index) + offset`。範囲外なら何も発火しない
- **`trig` 接続時**はその立ち上がりで、そのフレームの `index` に対応する出力を 1 フレーム発火
- **`trig` 未接続時**は `index` が変化した瞬間に発火。trigger 入力は未接続だと `undefined` が
  返る（`BeatClock` の `tap`/`onset` と同じ）ので、param を足さずに 2 モードを区別できる
- `offset` は 17 個目以降を 2 台目のルータで受けるためのもの

出力を 16 本にするのは `MidiPad` の 4×4 と 1 対 1 で対応させるため。このノードは
「多方向に分配すること自体」が目的なので縦に長いことは欠点になりにくい。

## 既存ノードの拡張（SamplePad / ClipLauncher）

どちらも `playPad(index)` という共通の入口を持ち、マウスクリックは `main.ts:293` からこれを
呼んでいる。ここへ配線で届く口を作る。

- 入力を 2 本追加: `padIndex`（number）／`padTrig`（trigger）
- `padTrig` の立ち上がりで `playPad(round(padIndex))` を呼ぶ

`index` と `trigger` は同じ `MidiPad` の `evaluate` が同一フレームに出力し、評価は DAG の
依存順に回るため、番号と発火がずれることはない。

この形にすると `MidiPad` → `SamplePad` は 2 本の配線で済み、`MidiPad` を 3 ポートに保てる。
また `padIndex`/`padTrig` は MIDI 専用の口ではないので、`BeatClock` の `div` や
`TapSequencer` から自動でクリップを切り替える使い方にもそのまま乗る。

## MIDI Learn

`NodeTypeDef` に `midiLearn: true` を足し、`editor/layout.ts` が行の矩形を計算、
`NodeEditor.ts` が描画とクリック処理をする。`beatClock: true` が TAP ボタン行を出しているのと
同じ経路。

- **LEARN ボタン** — 押すと待機に入り、そのときの `bus.currentSeq()` を覚える。以後の
  `evaluate` で `bus.lastEvent()` を見て、開始後に届いた該当種別（`MidiCC` は cc、
  `MidiNote`/`MidiPad` は note）の最初のイベントから ch と番号を取り、param へ書き戻す。
  書き戻しは `BeatClock` がタップ由来 BPM を `params.bpm` に書くのと同じ流儀（history 非経由）で、
  そのまま YAML 保存に乗り手編集もできる
- 待機中に再度押すとキャンセル
- **ステータス行** — `ch1 CC74` / `learning…` / `MIDI 非対応` / `権限なし` / `デバイスなし` を表示

`MidiPad` の learn は「左上パッドを叩いて `baseNote` を決める」。

## 範囲外（今回やらないこと）

- **OSC 受信**。UDP はブラウザから直接受けられず OSC→WebSocket 中継サーバが要る。
  node-vj は現状 Vite の静的配信のみで常駐サーバを持たないため、別 Issue に切り出す
- **velocity を `SamplePad` の発音音量へ反映**。既存 `volume` param との関係整理が要る
- **pickup / takeover**（param 値と物理ノブ位置のジャンプ防止）
- **MIDI 出力**（パッドの LED を光らせ返す等）
- **デバイス選択 param**。既定で全入力デバイスを受ける。デバイス名は接続順で変わりうるため
  param に持つとシーン保存の再現性が落ちる。複数台を使い分けたくなったら ch で分ける

### Bluetooth MIDI について

**追加実装は不要。** Web MIDI API は OS の MIDI ポート一覧を見せる API であり、macOS では
BLE MIDI 機器を「Audio MIDI 設定」でペアリングすると CoreMIDI に通常の MIDI ポートとして
登録される。USB 機器と区別なく `access.inputs` に現れるため、そのまま動く（Web Bluetooth API を
使う実装は要らない）。後から接続された機器も `onstatechange` の張り直しで拾える。

BLE は省電力で頻繁に切断・再接続するため、`no-device` 判定を `state` ベースにしてある（上記）。
レイテンシは USB より大きい（接続間隔に律速され概ね 10ms 前後）が、パラメータ操作用途では実害は
小さいと判断する。

### AudioContext についての既知の制約

マウスクリック経路では `main.ts` が `runtime.resumeAudio()` を呼ぶが、MIDI 入力はブラウザ的に
ユーザ操作と見なされない。ページを開いて一度も画面を触っていない状態では、MIDI で `SamplePad` を
叩いても音が出ない。実運用では必ず何か触ってから始めるため実害はないと判断し、仕様として記録する。

## テスト方針

Web MIDI API に依存しない純ロジックを最大化し、bun test で網羅する。
**自動テストで実機 MIDI デバイスには一切触らない。**

- `midi-message.test.ts` — バイト列 → `ControlEvent`（CC/NoteOn/NoteOff/velocity 0/対象外/長さ不足）
- `control-bus.test.ts` — omni の二重書き込み・`onCount` の累積・複数ノードからの独立読み出し・
  `lastOnSeq` の順序・`reset`
- `midi-node-logic.test.ts` — 値スケーリング・learn の状態機械・パッド index 算出
- `MidiCCNode.test.ts` / `MidiNoteNode.test.ts` / `MidiPadNode.test.ts` / `TriggerRouterNode.test.ts` —
  既存 `BeatClockNode.test.ts` と同型の最小 `EvalContext` を組み、`ControlBus` へ直接イベントを
  注入して出力を検証
- `SamplePad` / `ClipLauncher` の `padTrig` 追加分 — 立ち上がりで `playPad` が 1 回だけ呼ばれること

`shared-midi.ts`（唯一の DOM 依存）はテスト対象外。実機コントローラでの確認はユーザに委ねる。

## ファイル構成

```
src/apps/node-vj/midi/                    新規
  midi-message.ts / .test.ts              MIDI バイト列 → ControlEvent（純関数）
  control-bus.ts  / .test.ts              正規化状態の保持（純ロジック）
  shared-midi.ts                          Web MIDI 接続管理（唯一の DOM 依存）
src/apps/node-vj/nodes/
  midi-node-logic.ts / .test.ts           learn 状態機械・値スケーリング・パッド index
  MidiCCNode.ts / MidiNoteNode.ts / MidiPadNode.ts / TriggerRouterNode.ts (+ 各 .test.ts)
  SamplePadNode.ts / ClipLauncherNode.ts  padIndex + padTrig 入力を追加
  registry.ts                             4 ノードを登録
src/apps/node-vj/graph/node-type.ts       midiLearn / midiPad マーカーを追加
src/apps/node-vj/editor/
  layout.ts / NodeEditor.ts               midiLearn 行・midiPad グリッドの描画
src/apps/node-vj/main.ts                  runtime state ↔ エディタの連携
src/apps/node-vj/i18n-nodes.ts            ja/en の説明文
```

## 補足: 機能リファレンスの更新について

Issue が参照している `docs/vj-dj-feature-reference.md` は main で未追跡（ローカル作業ファイル）
のためこのブランチには存在せず、更新対象から外している。同ドキュメントの
「6. MIDI / OSC コントローラ対応 ❌」と「`MidiPadNode` は名前に反して Web MIDI API を使わない」
という記述は本対応で実態が変わるため、コミットされた時点で更新が必要。
