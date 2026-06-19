# #127 / #128 Audio 信号ルーティング（Mix ノード + Audio 出力ノード）

対象 Issue:
- https://github.com/mishi5/three-art/issues/127 （Audio Mix ノード）
- https://github.com/mishi5/three-art/issues/128 （Audio 出力ノード = audio sink）

関連: Epic #56 / #100 / #98（Screen 必須化の思想を audio にも適用）

## 方針（ユーザ確認済み）

- **案B（実音声信号ルーティング）を一括実装**。
- **命名（ユーザ指定で確定）**: ポート型/名 **`audio` = ルーティング可能な実音声信号**（`{ node: AudioNode }`）、
  **`signal` = 解析結果の音響特徴量バンドル**（AudioFeatures）。当初案の `audio`/`audioSignal` から入れ替え済み。
  visual の特徴量入力も `signal` に統一。VideoFileInput の抽出 param は出力 `audio` と紛れるため `extractAudio` に改名。
- **発音は出口必須に統一**（#98 流・破壊的変更）。Audio 出力ノードに繋がった音だけが鳴る。
- **AudioMix はミキサー**: 入力ごとの level（音量）+ マスタ gain で合成。

## 後方互換の制約（重要）

`src/core/audio/` の Source 群（`FileAudioSource` / `MicAudioSource` / `DisplayAudioSource`）と
`AudioInput` は **pose-particles でも使用**。破壊的変更を避けるため:
- 各 Source に `connectToDestination` オプションを追加。**既定は現状維持**
  （File=true で従来どおり発音 / Mic・Display=false でハウリング防止）。
- 各 Source に `output: AudioNode`（`src→analyzer→outputGain` の outputGain）を公開。
- node-vj 側は全 Source に `connectToDestination:false` を渡し、`output` を `audioSignal` として流す。
- pose-particles は無指定のまま従来挙動を維持（変更しない）。

## 共有 AudioContext

- これまで各音声入力ノードが個別に `new AudioContext()` していたのを、**runtime が 1 つ共有**する。
- `NodeEnv` に `audioContext: AudioContext` を追加。`GraphRuntime` が遅延生成し `env` で配布。
- node-vj の各音声ランタイム（`LiveAudioRuntime` / `AudioFileInputRuntime` / `VideoFileInputRuntime`）は
  `createState(env)` で共有 ctx を受け取り使用（自前生成を廃止）。user gesture で `resume()`。

## ノード

- **AudioOutput（#128, sink）**: 入力 `signal`(audioSignal)。createState で `gain→destination`。
  evaluate で受け取った signal.node を idempotent に connect/disconnect。`volume` / `mute` param。出力なし。
- **AudioMix（#127）**: 複数 `signal` 入力（in1..in4）→ 内部 mixGain → 出力 `signal`。
  さらに mixGain を AudioAnalyzer でタップし `audio`/各バンド/onset も出力（合成音で visual 駆動可）。
  `gain`（マスタ）param。

## 各音声入力ノード（Mic/Display/AudioFile/Video）

- `signal`(audioSignal) 出力ポートを追加。共有 ctx を使用、destination 直結を廃止。
- 既存の `audio`/各バンド/onset 出力は維持（解析用）。

## ポート/型

- `port-types.ts`: `audioSignal` を追加、`isCompatible` は厳密一致。NodeEditor の PORT_COLORS に色追加。

## テスト（headless 可能範囲）
- `port-types`: audioSignal の compat。
- 新ノードの port/param 定義、headless evaluate の安全デフォルト。
- 各 Source の `connectToDestination` 既定・`output` 存在（jsdom AudioContext 可能なら）。
- Web Audio の実配線（発音・ミックス）は手動確認。

## 動作確認
- AudioFile/Video を読み込み、`signal` を AudioOutput に繋ぐと鳴る。繋がないと無音（出口必須）。
- 複数入力を AudioMix → AudioOutput で合成して鳴る。Mix の audio 出力で visual も反応。
