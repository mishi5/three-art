# #140 DisplayAudioInput を AV 化（DisplayInput に改称・映像 texture も出力）

対象 Issue: https://github.com/mishi5/three-art/issues/140
関連: Epic #56 / #100 / #66（CameraInput パターン）/ #127 #128（音声信号）

## 目的

`getDisplayMedia` で捨てていた映像トラックを活かし、共有タブの音声＋映像を同時入力する
AV ノードにする。

## 変更

- `DisplayAudioInput` → **`DisplayInput`** に改称（旧 type の移行対応は不要・開発フェーズ）。
- **新ランタイム `DisplayInputRuntime`（node-vj 内）**: 1 回の `getDisplayMedia({audio, video:true})` で AV 取得。
  - 映像: `HTMLVideoElement` → `VideoTextureSurface` で contain-fit `texture` 出力（CameraInput パターン）。
  - 音声: `AudioAnalyzer` で解析（signal/各バンド/onset）＋ 実音声 `audio` 出力（destination 非接続＋無音 keep-alive）。
  - 音声オプショナル: 「タブ音声を共有」OFF（audio track 無し）でも throw せず映像のみ動かす（特徴量は default）。
  - audio/video の track `ended` を監視。
  - プレビュー小窓（骨格なし）。
- 出力: `texture` + `AUDIO_FEATURE_OUTPUTS`（signal/各バンド/onset）+ `audio`（実音声信号）。params: ONSET_PARAMS。
- `core/audio/DisplayAudioSource` は **pose-particles でも使用のため温存**（新ランタイムは node-vj 側に新規作成）。
- registry: DisplayAudioInput → DisplayInput。旧 `DisplayAudioInputNode.ts` は削除。

## テスト
- `display-input.test.ts`: ポート（texture + 特徴量 + audio）・onset param・preview 対象・registry 改称（旧 type 無し）。
- 既存テスト（audio-input-nodes / onset-tune）から DisplayAudioInput 参照を除去・DisplayInput へ。
- getDisplayMedia / VideoTextureSurface / renderer 依存は CameraInput 同様ユニット対象外（手動確認）。
- Playwright スモーク: start() を呼ばず（画面共有を起動しない）ノード追加で createState がエラーなし・
  registry 改称・出力ポート全揃いを確認。

## 動作確認
- DisplayInput を追加 → 入力開始（画面共有・タブ音声共有 ON 推奨）→ texture（共有タブ映像）と
  signal/bass/onset が出る。タブ音声 OFF でも映像は出る。プレビュー小窓に映像サムネ。
