# #100 AudioInput をマイク / ファイルで別ノードに分割

対象 Issue: https://github.com/mishi5/three-art/issues/100

親 Epic: #56 / 関連: #61（AudioInput 入力ノード）

## 背景・課題

現状 `AudioInput` ノードは単一ノードで `source`(mic/file/display) を enum 切替する方式。
マイク/画面音声（ライブ取得・`start()` user gesture）と、ファイル（`loadFile()`・section
解析・再生位置）は起動方法も付随情報も異なるのに 1 ノードに同居しており、複雑で役割が
一目で分からない。

## 方針（ユーザー確定事項）

- **3 ノードに分割**する:
  - `MicInput` — マイク（`MicAudioSource`）。`start()` で起動。
  - `DisplayAudioInput` — 画面音声（`DisplayAudioSource`、`getDisplayMedia`）。`start()` で起動。
  - `AudioFileInput` — 音声ファイル（`FileAudioSource`）。`loadFile()` で読込＋ `SongAnalyzer`/
    `SectionDetector` による section 解析・再生制御を担う。`section` 出力を持つ。
- **既存 `AudioInput` ノードは廃止**（registry から削除・ファイル削除）。
  - コミット済みプリセット無し・既定グラフ未使用。保存済みグラフに残っていても
    `deserializeGraph` が未知 type として破棄＋warning するだけ（移行コード不要）。

## 共通ロジック（重複回避）

新規 `src/apps/node-vj/nodes/audio-feature-logic.ts`:

- `ONSET_THRESHOLD` / `ONSET_COOLDOWN` 定数
- `AUDIO_FEATURE_OUTPUTS`: audio / volume / bass / mid / treble / onset のポート定義（section は含めない）
- `audioFeatureOutputs(audio, onset)`: 出力オブジェクトを組み立てる純関数
- `OnsetTracker`: `OnsetDetector` をラップし「このフレームで新規 onset が発火したか」を返す
- `LiveAudioRuntime`（抽象基底）: ctx 生成 / `start()` / `read()` / onset / `dispose()` を共有。
  サブクラスは `createSource(ctx)` だけ実装（Mic / Display）。

## ノード定義

- `MicInputNode.ts`: `MicInputRuntime extends LiveAudioRuntime`（`createSource = MicAudioSource`）。
  outputs = `AUDIO_FEATURE_OUTPUTS`。params 無し。
- `DisplayAudioInputNode.ts`: `DisplayAudioInputRuntime extends LiveAudioRuntime`（`createSource = DisplayAudioSource`）。
  outputs = `AUDIO_FEATURE_OUTPUTS`。params 無し。
- `AudioFileInputNode.ts`: `AudioFileInputRuntime`（独自。`loadFile` / section / currentTime）。
  outputs = `AUDIO_FEATURE_OUTPUTS` ＋ `section`(number)。params 無し。

## 既存への影響

- `registry.ts`: `AudioInputNode` 登録を削除し、`MicInput` / `DisplayAudioInput` / `AudioFileInput` を登録。
- `main.ts`: 下部バー「音声ファイル」入力は `AudioFileInput` ノードを探すよう更新。
  「入力開始 (mic/camera)」ボタンは全 `start()` 可能ノードを起動する既存挙動のままで Mic/Display も拾える。
- `input-nodes.test.ts`: `AudioInputNode` の describe を新 3 ノードのテストに置換。
  `nodeHasPreview` 判定も新ノードで確認（texture/previewSource 無し → false）。
- `serialize.test.ts`: 接続検証テストの `AudioInput` を `AudioFileInput` に差し替え
  （audio→number 型不一致 / bass→number OK の検証はそのまま成立）。
- `input-node-logic.ts`（`sectionIndexAt`）は AudioFileInput が引き続き使用（変更なし）。

## TDD 手順

1. `audio-feature-logic.test.ts`: `AUDIO_FEATURE_OUTPUTS` の id 順・型、`audioFeatureOutputs` の出力、
   `OnsetTracker` の発火（しきい値超え→true、cooldown 中→false）。
2. 新ノード 3 種の test: ポート定義（MicInput/DisplayAudioInput は section 無し、AudioFileInput は section 有り）、
   state 無し evaluate のデフォルト、`nodeHasPreview` = false。
3. 実装 → 旧 AudioInput 削除 → registry/main 更新 → 全テストパス。
4. `bunx tsc --noEmit` パス。
