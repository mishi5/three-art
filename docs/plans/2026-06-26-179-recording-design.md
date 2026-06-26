# #179 録画機能（出力をビデオとして録画・保存）

Issue: https://github.com/mishi5/three-art/issues/179
依存: #174（出力シーン分離。本ブランチは feature/174-output-scene の上に重ねる）

## やりたいこと

node-vj の出力をビデオ録画してファイル保存（ダウンロード）できるようにする。

## スコープ（このPR）

- **Phase 1（映像）+ Phase 2（音声込み）** を実装する。
- 録画ソースは **出力 canvas**（#174 の `getOutputCanvas()`）。出力シーンのピン/追従に自動追従する
  ＝「録画対象＝最終出力」。録画中は `setRecording(true)` で `outputActive` を強制し出力 canvas を
  更新し続ける（出力ウィンドウ未表示でも録画できる）。停止時は録画前の出力状態へ戻す。
- 音声は AudioOutput を `MediaStreamAudioDestinationNode`（recordDest）へも分岐し、その音声トラックを
  映像ストリームに合成して録画する。
- **muxer 停止問題への対策**: 音が鳴っていない間は無音トラックにサンプルが出ず、muxer が停止して
  映像ごと書き出されない（webm ヘッダのみ 110B）。対策として recordDest に **ConstantSource(offset 0)**
  を keep-alive として常時接続し、無音でもサンプルを流し続ける（録画分岐のみ。スピーカー出力には影響しない）。
- Phase 3（プレビュー/出力ウィンドウ等の明示的な録画対象選択 UI）は本PR対象外
  （出力 canvas が出力シーン選択に追従するため、当面は最終出力の録画で足りる）。

## 設計

### 録画ストリーム（GraphRuntime）

- `getRecordingStream(fps = 30, withAudio = true): MediaStream`
  - 映像: `getOutputCanvas().captureStream(fps)` のビデオトラック。
  - 音声: `withAudio` なら recordDest.stream のオーディオトラック。両方を新しい `MediaStream` に add。
- `getRecordingDestination()`: recordDest を遅延生成し、ConstantSource(offset 0) を keep-alive 接続。
- `env().recordingDestination = recordDest`。AudioOutput が gain を destination と recordDest の両方へ接続。
- `setRecording(on)`: 録画中は `outputActive` を強制 true（停止時は録画前の状態へ戻す）。

### NodeEnv / AudioOutput

- `NodeEnv.recordingDestination?: AudioNode` を追加。
- `AudioOutputNode.createState`: 非参照シーン時に `gain.connect(ctx.destination)` に加え、
  `env.recordingDestination` があれば `gain.connect(env.recordingDestination)`。

### Recorder（MediaRecorder ラッパ, recorder.ts 新規）

- `pickRecorderMimeType(isSupported)`（純関数）: vp9+opus → vp8+opus → webm の順で対応する最初を返す。
- `recordingFileName(date)`（純関数）: `node-vj-YYYYMMDD-HHMMSS.webm`。
- `class Recorder`: `start(stream, mimeType, videoBitsPerSecond?)` / `stop(): Promise<Blob>` / `recording`。
  ondataavailable で chunk 蓄積、onstop で結合 Blob を解決。

### 録画画質（解像度・ビットレート）

- 録画中は出力ウィンドウ表示時と同じく `OUTPUT_RENDER_W×H`（1920×1080）でレンダリングする
  （`applyPreviewSize` の高解像度条件に `recorder.recording` を追加。録画開始時にも明示的に
  `setRenderSize` する）。出力ウィンドウ非表示でも鮮明に録れる。
- `getRecordingStream` は captureStream 開始前に出力 canvas をレンダラ解像度へ合わせる
  （録画途中の解像度変化を避ける）。
- ビットレートは `videoBitsPerSecond = 16 Mbps`（既定の自動値は低すぎることがあるため明示）。

### UI（main.ts）

- 下部バーに「● 録画」ボタン。クリックで開始（`getRecordingStream` → `Recorder.start`、
  `runtime.setRecording(true)`）、再クリックで停止（`Recorder.stop` → Blob を `a[download]` で保存、
  `runtime.setRecording(false)`）。録画中はラベルを「■ 停止（録画中）」に。

## テスト

- 純関数（bun）: `recorder.test.ts` … pickRecorderMimeType の優先順位・全滅時の空文字、
  recordingFileName の桁揃え。
- Playwright スモーク: 録画開始→数フレーム→停止で十分なサイズ（>10KB）の webm Blob が得られる。
  ストリームに video トラック 1・audio トラック 1（keep-alive で無音でもサンプルが流れる）。
  録画ライフサイクル（recording true→false）。エラーが出ないこと。
