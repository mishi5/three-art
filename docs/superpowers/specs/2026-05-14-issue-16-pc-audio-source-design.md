# Issue #16: PC オーディオ (Chrome タブ音声) ソース対応

対象 Issue: https://github.com/mishi5/three-art/issues/16

## 背景・目的

現在の音源は「ファイル」「マイク」の 2 種類。Chrome タブで再生中の音源（YouTube など）を直接ビジュアライズしたいケースがあるため、ソースの選択肢に「PC音声」を追加する。`navigator.mediaDevices.getDisplayMedia({ audio: true, video: ... })` でタブ音声を `MediaStream` として取得し、既存の `AudioInput` 実装パターンに沿って組み込む。

## 設計方針

既存の `MicAudioSource` と同じ構造で `DisplayAudioSource` を追加し、UI 側に「PC音声」ボタンを並列追加する。最小実装を優先し、ガイド表示は失敗時のみ（成功パスは即起動）、外部停止時は終了を検知して内部状態を倒すのみで UI 自動更新はしない。

## アーキテクチャ

```
getDisplayMedia → MediaStream
  ├ video track → 即 stop して discard
  └ audio track → MediaStreamSourceNode → AudioAnalyzer.input
                   └ ended event → active = false
```

`destination` には接続しない。タブ自体は元々スピーカーに鳴り続けているのでユーザにはそのまま聞こえ、ハウリングも発生しない。

`App.setAudio(audio)` は既存実装で `this.audioInput?.stop()` を呼んでくれるので、別ソース（ファイル / マイク）への切り替えで自動的に MediaStream が解放される。

## コンポーネント

### 新規: `src/pose-particles/audio/DisplayAudioSource.ts`

`AudioInput` インターフェース実装。`MicAudioSource` をベースに以下を追加する。

- `start()`:
  - `getDisplayMedia({ audio: true, video: { ... } })` を呼ぶ。Chrome は audio-only 要求を許可しないため video を明示する。
  - 取得後、video track は全て `stop()` して破棄。
  - audio track が 0 個の場合は stream の全 track を停止してから `Error("タブの音声共有が ON になっていません。Chrome タブを選び『タブの音声を共有』を有効にしてください")` を throw。
  - audio track の `ended` イベントで `active = false`。stream / node 参照はそのままにしておき、次の `stop()` で disconnect する（イベントハンドラ内で disconnect しても良いが、`stop()` の冪等性を維持するためここでは状態フラグだけ倒す）。
  - 連打防止: `start()` の in-flight ガード (`starting` フラグ) で二重 spawn を弾く。
- `stop()`: node を disconnect、stream の全 track を stop、参照を null、`active = false`。
- `read()`: `active === false` なら `DEFAULT_AUDIO_FEATURES`、それ以外は `analyzer.read(ctx.sampleRate)`。

### 修正: `src/pose-particles/ui/UI.ts`

- `type Mode` に `"display"` を追加。
- ボタン行に「PC音声」を追加（「ファイル」「マイク」と並列）。
- 押下時に `switchToDisplay(errBox, statusEl)` を呼ぶ。基本構造は `switchToMic` と同じ。
- ステータス表示要素 `#display-status` を追加し、起動成功で「PC音声 使用中」を表示。
- 失敗時は `errBox` にメッセージを表示（既存パターン）。

## エラーハンドリング

| ケース | 表示メッセージ |
|---|---|
| ユーザが共有ダイアログをキャンセル (`NotAllowedError`) | `PC音声の取得がキャンセルされました` |
| audio track が無い（ウィンドウ/画面を選択した、音声共有 OFF） | `タブの音声共有が ON になっていません。Chrome タブを選び『タブの音声を共有』を有効にしてください` |
| getDisplayMedia 非対応ブラウザ | `このブラウザは PC 音声取得に対応していません` |
| その他 | エラーメッセージをそのまま表示 |

## 外部停止時の挙動

- audio track の `ended` イベントで `active = false` に倒す。`read()` は `DEFAULT_AUDIO_FEATURES` を返すようになるためビジュアルは自動で静止する。
- UI 表示の更新は行わない（最小実装）。再度音を出したい場合はユーザがソース切り替えボタンを押す。

## テスト

新規: `src/pose-particles/audio/DisplayAudioSource.test.ts`

`navigator.mediaDevices.getDisplayMedia` と `AudioContext.createMediaStreamSource`、`MediaStreamTrack` を mock してロジックを検証する。

- `start()` 成功後、`read()` が `DEFAULT_AUDIO_FEATURES` 以外を返すこと（analyzer の `read` を spy）。
- audio track が 0 個の MediaStream が返ったとき `start()` が reject し、stream の video track が `stop()` されること。
- 取得した video track が即時 `stop()` されること。
- audio track の `ended` イベント発火後、`read()` が `DEFAULT_AUDIO_FEATURES` を返すこと。
- `stop()` 後、stream の全 track が `stop()` されること、`read()` が `DEFAULT_AUDIO_FEATURES` を返すこと、二重 `stop()` が安全であること。
- `start()` の in-flight 中に再度 `start()` を呼んでも二重実行されないこと。

`UI.ts` の変更分は既存実装にもユニットテストが無いため、`bun build` と動作確認で代替する。

## 受け入れ条件（Issue 再掲）

- 「PC音声」ボタンから開始でき、Chrome タブ音声を選択するとビジュアルが反応する。
- 停止時にトラックが解放され、再度別ソースに切り替えられる。
- 取得失敗時はエラーメッセージが UI に表示される。

## スコープ外（Issue 明記）

- macOS / Windows のシステム音声全体の取り込み
- BlackHole 等の仮想オーディオデバイスをマイク経由で扱うためのデバイス選択 UI
- Safari / Firefox 対応（`getDisplayMedia` の audio キャプチャは Chrome 系前提）
