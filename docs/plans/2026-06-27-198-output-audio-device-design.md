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
