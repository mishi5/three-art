# #116 VideoFileInput から音声を抽出して音声特徴量を出力

対象 Issue: https://github.com/mishi5/three-art/issues/116
関連: Epic #56 / `AudioFileInputNode` / `audio-feature-logic`

## 目的

`VideoFileInput` で読み込んだ動画から音声を抽出し、`AudioFileInput` と同様の
音響特徴量（audio / 各バンド / onset）として利用できるようにする。同じ動画を
VideoFileInput と AudioFileInput に二重ロードする必要をなくし、A/V のズレも防ぐ。

## 設計方針（案 a を採用）

ユーザ確認の結果、(a)「VideoFileInput に audio 系出力を追加」を採用。
- 同一 `<video>` 要素由来なので映像と音声が原理的にずれない。
- (b) 専用ノードは `<video>` をノード間で共有する新ポート型が必要で重いため見送り。
- `section`（楽曲セクション）は decode-then-analyze 前提でリアルタイム取り込みと
  異なるため対象外（Issue 注記どおり）。

### 音声経路
`MediaElementAudioSourceNode(<video>) → AudioAnalyzer(AnalyserNode) → GainNode → destination`
- `MediaElementAudioSourceNode` は要素ごとに 1 度しか生成できないため保持し、ON 初回に構築。
- 特徴量は `AudioAnalyzer.read()`（既存・Mic/File と共通）で取得。
- onset は `OnsetTracker`（既存）を流用。

### 可聴化（ユーザ確認: opt-in・既定 OFF）
- `audio` param（enum off/on, 既定 off）を追加。
- OFF: `gain=0` + `video.muted=true` で従来どおり無音・映像のみ（既存グラフを壊さない）。
- ON: `video.muted=false` + `gain=1` で解析しつつスピーカーへ再生。`AudioContext.resume()`。

## 出力・パラメータ
- outputs: `texture` + `AUDIO_FEATURE_OUTPUTS`（audio/volume/bass/mid/treble/onset）。
- params: `loop` / `audio`(off,on=既定off) / `onsetThreshold` / `onsetCooldown`（ONSET_PARAMS 共有）。
- evaluate: state 無し or audio=off は音響特徴量デフォルト（onset=false）。audio=on で実特徴量。

## テスト
- `nodes/video-audio.test.ts`: 出力/param 定義、audio 既定 off、state 無しのデフォルト、preview 対象。
- `nodes/input-nodes.test.ts`: 既存 VideoFileInput テスト2件を新仕様へ更新。
- Web Audio 実経路（audio=on の可聴・解析）は headless 不可のため手動確認に委ねる。

## 動作確認
dev サーバで VideoFileInput に動画を読み込み、`audio` を on にすると音が鳴り、
bass/onset 等が動く（visual ノードへ繋いで反応を確認）。off で無音に戻ること。
