# #198 出力シーンの音声を別オーディオ出力デバイスへ（モニター/プログラム分離）設計

Issue: https://github.com/mishi5/three-art/issues/198
関連: #174（出力シーン分離）, #179（録画）, #172（参照先シーン音声）

## ゴール

出力シーン（#174 でピン留めした「出力中」のシーン）の音声を、編集中シーンの音声とは
別のオーディオ出力デバイスへ発音できるようにする（モニター/プログラム分離）。
手元のヘッドホン＝編集音、別オーディオ I/F → PA ＝本番出力音、という VJ 運用を実現する。

## 現状（コードの事実）

- 編集（アクティブ）シーンの `AudioOutput` は `gain → ctx.destination`（既定デバイス）へ発音する
  （`AudioOutputNode.ts` createState: `!referencedScene` のとき destination 接続）。
- 参照先（ピン留め出力シーン含む）の `AudioOutput` は `gain → res.audioMerge` に集約され
  `sceneAudioCache[sceneId]` に積まれるが **destination 非接続＝今はどこにも発音されない**。
- 出力シーンがピン（編集と別）のとき、`runtime.renderReferencedScenes` が `extraRoots=[effectiveOutputId]`
  でそのシーンを参照先として評価するため、`sceneAudioCache[effectiveOutputId]` は既に埋まる。
- `recordDest`（#179）が「集約 gain を MediaStreamAudioDestination へ分岐」する先例。
  無音でも muxer を止めないため `ConstantSource(offset 0)` を keep-alive 接続している。

→ 集約点（`sceneAudioCache[effectiveOutputId]`）は既にあるので、そこを別 dest へ流して
`<audio>.setSinkId` で任意デバイスへ出すだけでよい。

## 方針（方式A: `<audio>.setSinkId`）

1. `GraphRuntime` に `outputAudioDest`（`MediaStreamAudioDestinationNode`）を 1 本、遅延生成で持つ
   （`recordDest` と同じパターン。keep-alive `ConstantSource(offset 0)` も付ける）。
2. tick で `sceneAudioCache[effectiveOutputId]` → `outputAudioDest` を接続/差し替え（出力シーンの
   ピン/追従に追従。録画 dest と同じ「変化時のみ繋ぎ替え」）。
3. `main` に隠し `<audio>` を 1 つ置き `srcObject = runtime.getOutputAudioStream()`、
   デバイス選択ドロップダウンで `audioEl.setSinkId(deviceId)`。
4. ドロップダウンは `navigator.mediaDevices.enumerateDevices()` の `audiooutput` から構築。

### ポリシー: まずは「ピン時のみ分離」

- 出力が**追従**（`effectiveOutputId === activeSceneId`）のとき: 出力＝編集シーンで、その音は
  既に `ctx.destination`（既定デバイス）で鳴っている。別デバイスへは出さない（二重発音を避ける）。
- 出力が**ピン**（`effectiveOutputId !== activeSceneId` かつ `outputActive`）のとき: ピン中の
  出力シーンの集約音声を `outputAudioDest` へ流し、選択デバイスで発音する。

判定は純関数 `outputAudioSourceId()` に切り出してテストする。

## 追加/変更

- 新規 `scene/output-audio.ts`（純関数）:
  - `outputAudioSourceId({ outputActive, effectiveOutputId, activeSceneId })`: 分離して発音すべき
    シーン id（無ければ null）。ピン時のみ分離。
  - `audioOutputOptions(devices)`: `MediaDeviceInfo[]` → `{ deviceId, label }[]`（audiooutput のみ・
    ラベル空時のフォールバック名）。
- 新規 `scene/output-audio.test.ts`（純関数テスト）。
- `graph/runtime.ts`:
  - フィールド `outputAudioDest` / `outputAudioConnected`。
  - `getOutputAudioStream()`: dest 遅延生成（keep-alive 付き）＋ `stream` 返却。
  - `private updateOutputAudioRouting()`: tick から呼び、`outputAudioSourceId` の結果に従い接続差し替え。
  - `tick()` 末尾で `updateOutputAudioRouting()` を呼ぶ（dest 未生成なら即 return＝オーバヘッド無し）。
- `main.ts`: 下部バーに「🔈 出力音声デバイス」ドロップダウン。選択で `<audio>.setSinkId`。
  隠し `<audio>` に `runtime.getOutputAudioStream()` を流す。マイク権限が無いとラベルが空になる旨は
  フォールバック名（「音声出力 N」/「システム既定」）で吸収する。

## keep-alive の要否

`MediaStreamAudioDestinationNode` は消費側（`<audio>`）が pull する限りサンプルを出し続けるため、
録画 muxer のような「無音で停止」は理屈上起きない。ただし `recordDest` と挙動を揃え、AudioContext の
グラフが確実に駆動されるよう、同じく `ConstantSource(offset 0)` を keep-alive 接続する（無害）。

## テスト方針

- 純関数（`outputAudioSourceId` / `audioOutputOptions`）をユニットテストで担保。
- `GraphRuntime` は `WebGLRenderer` 生成を伴い happy-dom で実体化できないため直接テストしない
  （既存 runtime も同様にスモーク/手動確認）。配線ロジックは純関数へ寄せて間接的に担保する。
- 実デバイス出力（別オーディオ I/F での発音・A/V 同期）は headless 検証不可＝手動確認に委ねる。

## 手動確認

- ピン留めした出力シーンに音（AudioFile 等）を載せ、下部バーのデバイス選択で別デバイスを選ぶ。
- 編集音は既定デバイス、出力音は選択デバイスから鳴ることを確認。
- 出力を追従に戻すと別デバイス発音が止まる（編集音のみ）ことを確認。

---

## 追補（動作確認で判明した二重発音と、モニター出力デバイス選択の追加）

### 発見したバグ（根本原因）

手動確認で次の事象が判明した:

- **編集中シーンが出力シーン（ピン）から SceneInput 参照されている**とき、編集中シーンの音が
  「既定デバイス（ヘッドホン）」と「選択した出力デバイス」の**両方で重なって鳴る**。
- 編集中シーンが出力から参照されていない（無関係な別シーンを編集中）ときは正常に分離される。

根本原因は音声経路の二重化:

1. 編集中シーン Z は **active** として `runtime.env()` で評価される。この env には `referencedScene`
   が無い（＝`false`）ため、Z の `AudioOutput` は `gain → ctx.destination`（既定デバイス）へ発音する。
   同時に `captureSceneAudio` で `activeAudioMerge` にタップされ `sceneAudioCache[Z]` に積まれる。
2. 出力シーン Y（Z を SceneInput 参照）は参照先として評価され、`SceneInput(Z)` 経由で Z の音を
   取り込み `sceneAudioCache[Y]`（Z を含む）に集約する。
3. `updateOutputAudioRouting` が `sceneAudioCache[Y]` を `outputAudioDest`（選択デバイス）へ流す。

→ Z の音が **`ctx.destination`（既定）と `outputAudioDest`（選択）の両方**に出る。これは #198 で
出力経路を初めて実デバイス発音にしたことで顕在化した（従来は出力シーンの音がスピーカー非発音
だったため Z は既定でしか鳴らなかった）。

### 解決方針: モニター出力デバイスも選択可能にする（編集音と出力音を独立 2 系統に）

編集音（モニター）の発音先デバイスも選べるようにし、モニターとプログラムを別物理デバイスへ
振り分けられるようにする。これにより Z が両系統に出ても別デバイスなので重ならない。

`AudioOutput` の発音先を `ctx.destination` 固定から、runtime 管理の **`monitorBus`（GainNode）経由**に
変える。デバイス切替は runtime が `monitorBus` の出力先を 1 箇所繋ぎ替えるだけで済む:

- runtime は `monitorBus` を常時持ち、起動時に `monitorBus → ctx.destination`（既定）へ繋ぐ。
- active シーンの `AudioOutput` は `ctx.destination` の代わりに `env.monitorBus` へ発音する
  （`env.monitorBus ?? ctx.destination` のフォールバック付きで後方互換）。
- モニターデバイス選択時: runtime が `monitorBus → ctx.destination` を外し
  `monitorBus → monitorAudioDest`（`MediaStreamAudioDestination` + keep-alive）へ繋ぎ替え、
  `main` の隠し `<audio>.setSinkId(deviceId)` で選択デバイスへ発音する。
- モニターデバイス未選択（既定）時は `ctx.destination` 直結相当で**遅延が増えない**
  （MediaStream 経由の A/V 遅延はユーザーが明示的に別デバイスを選んだときのみ発生）。

### 追加/変更（追補分）

- `graph/node-type.ts`: `NodeEnv` に `monitorBus?: AudioNode` を追加。
- `nodes/AudioOutputNode.ts`: 発音先を `env.monitorBus ?? ctx.destination` に。createState/evaluate の
  destination 整合も同じ接続先（state に `destNode` を保持）を対象にする。
- `graph/runtime.ts`:
  - `monitorBus`（常時生成・起動時に `ctx.destination` へ接続）、`monitorAudioDest`/`monitorAudioConnected`。
  - `env()` で `monitorBus` を渡す。
  - `getMonitorAudioStream()`（dest 遅延生成＋keep-alive）、`setMonitorSeparation(on)`
    （monitorBus の出力先を `ctx.destination` ⇄ `monitorAudioDest` で繋ぎ替え）。
- `main.ts`: 下部バーに「🎧 モニター音声デバイス」ドロップダウン（既存「🔈 出力音声」と並ぶ 2 本）。
  選択で `runtime.getMonitorAudioStream()` を隠し `<audio>` に流し `setSinkId` ＋ `setMonitorSeparation(true)`、
  空選択で既定へ戻す（`setMonitorSeparation(false)`）。

### テスト方針（追補分）

- `AudioOutputNode` の発音先切替（`env.monitorBus` 指定時は monitorBus、未指定時は destination、
  referenced 時はどちらにも繋がない、移譲後の整合も monitorBus 対象）を `fakeCtx` でユニットテスト。
- runtime の `monitorBus` 繋ぎ替え・`<audio>.setSinkId`・実デバイス発音は headless 検証不可＝手動確認。

### 手動確認（追補分）

- モニターデバイスにヘッドホン、出力デバイスに別 I/F を選ぶ。
- 編集中シーンが出力シーンから SceneInput 参照されている構成で、ヘッドホンに編集音が重ならず
  1 系統で聞こえ、出力音は別 I/F から鳴ることを確認。

---

## 追補2（出力シーンをエディタ表示中に出力デバイスから音が出ない問題）

### 症状

モニター分離を使った状態で、**出力中のシーンをそのままエディタで開く**（出力シーン＝編集中シーン）と、
出力デバイス（プログラム）から音が出ず、モニターデバイスからしか聞こえない。

### 根本原因

`outputAudioSourceId` のポリシーが「ピン時のみ分離（`effectiveOutputId === activeSceneId` なら null）」
だったため、出力シーンをエディタ表示中は `effectiveOutputId === activeSceneId` となり、`outputAudioDest`
（出力デバイス）へ何も流れない。これは「モニター＝既定デバイス固定」前提で二重発音を避けるための条件
だったが、モニターを別デバイスへ分離できるようになった今は不要で、むしろ出力デバイスの音を止めてしまう。

### 修正

`outputAudioSourceId` を「**出力中（`outputActive`）なら常に `effectiveOutputId` を返す**」に変更
（`activeSceneId` 比較を撤去。引数は後方互換のため optional で残置・未使用）。これにより出力シーンを
エディタ表示中でも出力デバイスから発音される。編集音はモニターバス経由で別系統へ流れるため、
モニターと出力を別デバイスに分けていれば重複しない（同一デバイスを選んだ場合のみ重複＝運用で回避）。

- `scene/output-audio.ts`: `outputAudioSourceId` から `effectiveOutputId === activeSceneId → null` を撤去。
- `scene/output-audio.test.ts`: 「追従中は null」を「出力シーンを編集中でも出力 id を返す」に更新。

### 手動確認（追補2）

- 出力中のシーンをエディタで開いた状態で、出力デバイス（スピーカー）から出力音が鳴ること。
- モニターデバイス（ヘッドホン）からも編集音が聞こえ、両者が別デバイスで分離していること。
