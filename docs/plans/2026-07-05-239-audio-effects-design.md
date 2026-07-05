# #239 音声エフェクトノード（AudioFilter / AudioGain / AudioReverb）設計

Issue: https://github.com/mishi5/three-art/issues/239

## 目的

音声系 process ノードは AudioMix（合流）と AudioDelay（遅延）のみで加工手段が乏しい。
Web Audio 標準ノードで実装しやすい 3 種（フィルタ・ゲイン・リバーブ）を追加し、
フィルタの frequency を LFO で振る等、映像エフェクトと同じ感覚で音を動かせるようにする。

## 追加ノード（すべて category: process・audio in → audio out）

### AudioFilter（BiquadFilterNode）

| param | kind | 範囲 | 既定 | 説明 |
|---|---|---|---|---|
| type | enum | lowpass / highpass / bandpass | lowpass | フィルタ種別 |
| frequency | number | 20〜20000 | 1000 | カットオフ/中心周波数（Hz） |
| Q | number | 0.1〜20 | 1 | レゾナンス（尖り） |

### AudioGain（GainNode）

| param | kind | 範囲 | 既定 | 説明 |
|---|---|---|---|---|
| gain | number | 0〜2 | 1 | 音量（フェード/ダッキング用） |

### AudioReverb（ConvolverNode・生成 IR）

| param | kind | 範囲 | 既定 | 説明 |
|---|---|---|---|---|
| decay | number | 0.1〜8 | 2 | 残響の長さ（秒）。変更時に IR を再生成 |
| mix | number | 0〜1 | 0.3 | dry/wet（0=原音のみ, 1=残響のみ） |

内部グラフ:

```
in(GainNode, 接続点) ─┬─ dryGain ────────┬─ out(GainNode)
                      └─ convolver ─ wetGain ┘
```

- IR は外部ファイルを使わず、ホワイトノイズ × 減衰カーブ `(1 - t/T)^2.5` で生成する
  （純粋関数 `buildImpulseResponse`。rng 注入でテスト可能）。
- decay 変更時のみ再生成する（0.01 秒未満の揺れでは再生成しない。number 駆動で毎フレーム
  微小変動しても AudioBuffer 生成が暴発しないためのガード）。
- dry/wet は GainNode 2 本の線形クロスフェード（dry=1-mix, wet=mix）。

## 共通設計

- **既存流儀の踏襲**: AudioDelayNode と同じく、`createState(env)` で共有 AudioContext 上に
  WebAudio ノードを作り、`evaluate` で入力 AudioNode の差分接続（変化時のみ connect/disconnect）、
  `signalOutput()` で audio 出力を返す。state 無し（headless テスト）では `audio: undefined`。
- **param の number 駆動**: 数値 param は既存の param 入力ポート化（node-ports.ts）に自動で乗る
  （number/int かつ noInput でない param は入力ポートになる）。enum の type は手動選択のみ。
- **クリックノイズ回避**: frequency / Q / gain / dry / wet の AudioParam は直接 `.value` 代入
  でなく `setTargetAtTime`（時定数 0.03s）で追従させる。値が変わったフレームだけ呼ぶ
  （automation イベントの毎フレーム積み上げ回避）。ヘルパ `applySmoothParam` に切り出しテスト。
- **論理切断＝物理 disconnect（#198）**: 入力の繋ぎ替え時は旧ノードを disconnect、
  `disposeState` では入力＋内部ノードすべてを disconnect する。

## ファイル構成

- `src/apps/node-vj/nodes/audio-effect-logic.ts` — 純粋ロジック
  （`readNumberParam` / `readFilterType` / `wetDryLevels` / `buildImpulseResponse` / `applySmoothParam`）
- `src/apps/node-vj/nodes/AudioFilterNode.ts`
- `src/apps/node-vj/nodes/AudioGainNode.ts`
- `src/apps/node-vj/nodes/AudioReverbNode.ts`
- `src/apps/node-vj/nodes/audio-effect-logic.test.ts` — IR 生成・param 検証・平滑化ヘルパ
- `src/apps/node-vj/nodes/audio-effect-nodes.test.ts` — ノード定義・レジストリ・headless 評価・接続追従
- `src/apps/node-vj/nodes/registry.ts` — process へ 3 種登録

## テスト方針（TDD）

- IR 生成: 長さ = sampleRate×decay、振幅が [-1,1]、前半 RMS > 後半 RMS、decay クランプ。
- param 検証: 範囲クランプ・非数フォールバック・enum 検証・wet/dry 値。
- 平滑化: 値変化時のみ setTargetAtTime が呼ばれる（モック AudioParam）。
- ノード定義: type/category/ポート型/param 既定値・レジストリ登録・state 無し評価。
- 接続追従: モック AudioNode で connect/disconnect の対称性（繋ぎ替え・dispose）を検証。
- 実音の確認（音色変化・ノイズ有無）は手動確認に委ねる。
