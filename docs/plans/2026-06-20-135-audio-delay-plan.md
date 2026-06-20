# #135 音声遅延再生ノード（DelayNode で音を映像に同期）

対象 Issue: https://github.com/mishi5/three-art/issues/135
関連: Epic #56 / #127 #128（音声信号ルーティング）/ #116 / #115

## 目的

リアルタイム解析では映像が「取り込み→解析→評価→描画」分だけ遅れる。音を同じだけ遅らせて
出力することで A/V を一致させる。

## 方針（#127/#128 のルーティング基盤に整合）

Issue 当時は DisplayAudioSource を直接拡張する案だったが、#127/#128 で `audio` 信号ポートと
AudioOutput が入ったため、**独立した AudioDelay ノード（process）**として実装する方が綺麗。
- `source.audio → AudioDelay → AudioOutput` と繋ぐ。
- 解析（signal/各バンド/onset）はソース側でリアルタイムのまま → 映像はリアルタイム駆動。
- 音だけ DelayNode で遅らせて発音 → A/V 一致。向きは「音を映像に合わせて遅らせる」。

## 実装 `nodes/AudioDelayNode.ts`
- `audio` in → `audio` out（SIGNAL_OUTPUT）。
- createState(env): `ctx.createDelay(MAX_DELAY_SEC=5)`。
- evaluate: 入力 AudioNode を delay へ idempotent 接続、`delayMs/1000`（0〜5s クランプ）を delayTime に、
  `audio: {node: delay}` を出力（AudioOutput/AudioMix と同じ接続管理パターン）。
- `delayMs` スライダ（0〜2000ms・既定 0）で耳と目で手動調整。

## テスト
- `audio-delay.test.ts`: ポート/param 定義・headless（audio=undefined）・registry 登録。
- Playwright スモーク: AudioMix→AudioDelay→AudioOutput を配線し createDelay/接続がエラーなく、
  AudioDelay が audio 信号を出力することを確認。

## 運用（Issue 記載）
- 元タブはタブミュートでローカル再生を止める（キャプチャは生存）→ 二重再生回避・仮想デバイス不要。

## 動作確認
- DisplayAudioInput/AudioFileInput 等の audio → AudioDelay(delayMs) → AudioOutput で発音し、
  delayMs を調整して音と映像が合うこと。
