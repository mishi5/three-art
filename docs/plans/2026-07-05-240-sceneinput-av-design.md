# #240 SceneInput の出力を VideoFileInput 相当に拡充（参照先シーンの音声・特徴量）

Issue: https://github.com/mishi5/three-art/issues/240

## 背景と現状

`SceneInput`（#152/#172）は現在 `texture` と `audio`（参照先シーンの集約音声）を出力する。
`audio` は #172 で追加済みで、参照先シーンの AudioOutput が `env.captureSceneAudio(gain)` で
シーンごとの merge gain（`sceneRes[id].audioMerge` / アクティブは `activeAudioMerge`）へタップされ、
`env.sceneAudio(sceneId)` がその merge を返す仕組み（#198 で物理 disconnect の不変条件も整備済み）。

一方、VideoFileInput（#116）は texture / audio に加えて音響特徴量
（`AUDIO_FEATURE_OUTPUTS`: signal / volume / bass / mid / treble / trigger）を出力する。
SceneInput にはこれが無く、参照先シーンの音で下流の visual を駆動できない。

## 目標

- SceneInput の出力ポートを VideoFileInput と同じ構成に揃える:
  `texture, signal, volume, bass, mid, treble, trigger, audio`（既存ポート id は不変）。
- 特徴量は参照先シーンの集約音声から解析する。
- 既存グラフ互換: 出力ポート追加のみ。未接続ポートは従来どおり無視。

## 設計判断

### D1: 音声集約は既存の merge を再利用する（新しい集約バスは作らない）

参照先シーンの集約音声は #172/#198 で既に merge gain として存在し、`env.sceneAudio(sceneId)` で
引ける。SceneInput 側で新たに走査・集約する仕組みは作らず、この merge をタップ元として使う。
アクティブシーン参照（#174 の activeAudioMerge）もそのまま使える。

### D2: 特徴量は SceneInput 自身の AnalyserNode で解析する（参照先の解析結果は引き回さない）

代替案として「参照先シーン内の解析結果（AudioMix 等の signal）をランタイム経由で引き回す」も
検討したが、参照先に解析ノードが無い構成では特徴量が出ない・シーン単位の解析結果キャッシュ
管理が増える、の 2 点で不採用。AudioMix（#127）と同型に、SceneInput の state が自前の
`AudioAnalyzer` + `OnsetTracker` を持ち、merge → analyser のタップで解析する。
複数 SceneInput が同じシーンを参照しても各自の analyser を持つだけで、発音経路には影響しない
（analyser は可聴経路に繋がらないため二重発音しない）。

### D3: タップの寿命管理は差分接続（AudioNodeTap）＋ dispose で物理 disconnect

タップ元 merge の同一性は変わり得る:

- sceneId param の変更（参照先の切り替え）
- 参照が外れて `sceneRes` が破棄→再参照で merge が再生成される
- アクティブシーン切替（activeAudioMerge ⇄ sceneRes[id].audioMerge の入れ替わり、#174/#198）
- 参照先が消えて `env.sceneAudio` が null を返す

これらを毎フレームの差分接続（前回接続ノードと比較し、変化時のみ disconnect→connect）で追従する。
`updateOutputAudioRouting`（#198）と同じパターンを純クラス `AudioNodeTap` に切り出してテストする。
disposeState 時は必ず物理 disconnect（#198 の不変条件「論理的に忘れる＝必ず物理 disconnect」）。

### D4: keep-alive（無音 gain 0 → destination）で解析グラフを生かす

参照先シーンの AudioOutput.gain は referencedScene では destination 非接続（#172）。下流が
SceneInput の feature ポートだけを使う（audio を AudioOutput へ繋がない）構成では、merge から
destination への可聴経路が無く解析グラフが駆動されない恐れがある。AudioMix / VideoFileInput
（#128）と同じく、analyser → gain(0) → destination の keep-alive を state 生成時に張る。
gain 0 なので発音はしない（二重発音なし）。

### D5: 互換性・安全デフォルト

- ポートは追加のみ。既存の `texture` / `audio` の id・意味は不変（エッジは portId 参照なので順序変更は無害）。
- sceneId 未設定・state 無し（テスト等）でも安全: 特徴量は `DEFAULT_AUDIO_FEATURES`、trigger=false、
  audio は従来どおり `env.sceneAudio` の値をそのまま返す。
- sceneId が空になったフレームでもタップを null 更新して物理 disconnect する（放置しない）。
- onset 調整 param（onsetThreshold / onsetCooldown、#109）を VideoFileInput と同様に追加。
  既存保存グラフに無くても `readOnsetParams` が既定値へフォールバックする。

### D6: 循環参照

シーン参照の循環は既存 #152（`wouldCreateSceneCycle` による UI 除外・`sceneRenderOrder` の
onStack 保険）で防止済み。本件では変更しない。

## 変更ファイル

- 新規 `src/apps/node-vj/nodes/audio-tap.ts` — `AudioNodeTap`（差分タップ管理の純クラス）
- 新規 `src/apps/node-vj/nodes/audio-tap.test.ts`
- 変更 `src/apps/node-vj/nodes/SceneInputNode.ts` — `SceneInputRuntime`（analyser + tap + onset）、
  出力ポート拡充、createState / disposeState、evaluate の特徴量出力
- 変更 `src/apps/node-vj/nodes/scene-input-node.test.ts` — ポート構成・タップ追従・解析・dispose のテスト

## テスト計画（TDD）

1. AudioNodeTap: 初回 connect / 同一 src では再接続しない / 差し替えで旧 disconnect→新 connect /
   null で切断 / dispose で切断 / disconnect 例外でも続行
2. SceneInputNode 定義: 出力ポートが VideoFileInput と同構成・onset params・sceneId hidden
3. evaluate（state 無し）: 従来互換（texture / audio パススルー・特徴量は安全デフォルト）
4. evaluate（state あり）: sceneAudio の merge を analyser へタップ / sceneId 変更・merge 再生成で
   繋ぎ替え / sceneId 空で切断 / fake analyser の周波数データから volume・bass 等を出力 /
   bass の立ち上がりで trigger 発火 / disposeState で物理 disconnect
5. keep-alive: state 生成時に gain(0) → destination が張られる

## 手動確認項目

- シーン B で AudioFileInput（または VideoFileInput audio=on）→ AudioOutput を再生。
  シーン A に SceneInput(B) を置き、bass / volume を visual の param に接続して映像が音に反応する
- SceneInput(B).audio → AudioOutput（A 側）で B の音が鳴る（従来 #172 相当・二重発音しない）
- 同じ B を参照する SceneInput を 2 個置いてもクラッシュ・二重発音しない
- 参照先の切り替え（sceneId 変更）・シーン切替（アクティブ⇄参照）後も特徴量が追従する
