# #179 録画機能（出力をビデオとして録画・保存）

Issue: https://github.com/mishi5/three-art/issues/179
依存: #174（出力シーン分離。本ブランチは feature/174-output-scene の上に重ねる）

## やりたいこと

node-vj の出力をビデオ録画してファイル保存（ダウンロード）できるようにする。

## スコープ（このPR）

- **Phase 1（映像のみ）** を実装する。
- 録画ソースは **出力 canvas**（#174 の `getOutputCanvas()`）。出力シーンのピン/追従に自動追従する
  ＝「録画対象＝最終出力」。録画中は `setRecording(true)` で `outputActive` を強制し出力 canvas を
  更新し続ける（出力ウィンドウ未表示でも録画できる）。停止時は録画前の出力状態へ戻す。
- **Phase 2（音声込み）は本PR対象外**。検証時、`MediaStreamAudioDestinationNode` の無音トラックを
  混ぜると（headless で AudioContext の音声レンダリングが回らない環境では）muxer が停止し映像も
  書き出されない（ヘッダのみ）問題を確認したため、無音トラック対策を含めて別途実装する。
- Phase 3（プレビュー/出力ウィンドウ等の明示的な録画対象選択 UI）も本PR対象外
  （出力 canvas が出力シーン選択に追従するため、当面は最終出力の録画で足りる）。

## 設計

### 録画ストリーム（GraphRuntime）

- `getRecordingStream(fps = 30): MediaStream`
  - 映像: `getOutputCanvas().captureStream(fps)` のビデオトラックのみを新しい `MediaStream` に add。
- `setRecording(on)`: 録画中は `outputActive` を強制 true（停止時は録画前の状態へ戻す）。

### Recorder（MediaRecorder ラッパ, recorder.ts 新規）

- `pickRecorderMimeType(isSupported)`（純関数）: vp9+opus → vp8+opus → webm の順で対応する最初を返す。
- `recordingFileName(date)`（純関数）: `node-vj-YYYYMMDD-HHMMSS.webm`。
- `class Recorder`: `start(stream, mimeType)` / `stop(): Promise<Blob>` / `recording`。
  ondataavailable で chunk 蓄積、onstop で結合 Blob を解決。

### UI（main.ts）

- 下部バーに「● 録画」ボタン。クリックで開始（`getRecordingStream` → `Recorder.start`、
  `runtime.setRecording(true)`）、再クリックで停止（`Recorder.stop` → Blob を `a[download]` で保存、
  `runtime.setRecording(false)`）。録画中はラベルを「■ 停止（録画中）」に。

## テスト

- 純関数（bun）: `recorder.test.ts` … pickRecorderMimeType の優先順位・全滅時の空文字、
  recordingFileName の桁揃え。
- Playwright スモーク: 録画開始→数フレーム→停止で十分なサイズ（>10KB）の webm Blob が得られる。
  ストリームに video トラック 1・audio トラック 0。録画ライフサイクル（recording true→false）。
  エラーが出ないこと。
