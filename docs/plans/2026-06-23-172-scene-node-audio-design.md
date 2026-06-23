# #172 シーンノードの音声対応（#152 Phase 2）設計

- Issue: https://github.com/mishi5/three-art/issues/172 （#152 Phase 2・Epic #56）
- 依存: #152 Phase 1（SceneInput・scene-refs・runtime のシーン事前評価／マージ済み）, #154 アセットライブラリ, #151 シーン管理

## 目的
SceneInput で参照したシーンの音声を扱えるようにする。
- **A. 参照先シーンの音声解析**: 参照先の AudioFileInput/VideoFileInput を読込・再生して音響特徴量を走らせ、**音声駆動の映像エフェクトが参照先でも動く**（Phase 1 で静止していたバグの解消）。
- **B. 音声のポート出力**: 参照先シーンの音声を `SceneInput` の `audio` ポートとして公開し、親グラフの AudioMix/AudioOutput で Mix・発音できる。

## 背景（Phase 1 の制限）
参照先シーンは専用 state で毎フレーム評価されるが、AudioFileInput 等が loadFile/start されず音響特徴量が DEFAULT（ゼロ）。`restoreAssets()` もアクティブグラフのみ。→ 参照先の音声駆動ビジュアルが動かない。

## A. 参照先シーンの音声解析
- ランタイムに `setSceneAssetRestorer(fn: (node: NodeInstance, state: NodeState) => void)` を追加。
- `syncStatesFor`（参照先シーン専用 state 同期）で state を**新規生成した直後**、`loadFile` を持つノード（`def.fileInput`）かつ `params.assetId` が非空なら restorer を呼ぶ。
- main の restorer: `library.getFile(assetId).then((f) => (state as FileLoadable).loadFile(f))`（fire-and-forget・失敗は warn）。
- AudioFileInput は `connectToDestination:false` のため**無音のまま解析**（音は B 経由でのみ発音）。

## B. 参照先の音声を親へ出力
### env 拡張（`graph/node-type.ts`）
```ts
interface NodeEnv {
  // 既存 ... sceneTexture?
  referencedScene?: boolean;                 // 参照先シーンとして評価中
  captureSceneAudio?(node: AudioNode): void;  // そのシーンの音声出力ノードを通知
  sceneAudio?(sceneId: string): AudioNode | null; // 参照先シーンの音声出力（SceneInput 用）
}
```

### AudioOutputNode（`nodes/AudioOutputNode.ts`）を文脈対応
- `createState(env)`: `env.referencedScene` のときは gain を **destination へ接続しない**（active 時のみ接続＝二重発音防止）。
- `evaluate(ctx)`: 従来どおり入力 signal→gain を接続し volume/mute を反映。加えて `ctx.env?.captureSceneAudio?.(gain)` を呼んで自分の gain をシーン音声として通知。

### ランタイム（`graph/runtime.ts`）
- 参照先シーン res に **マージ GainNode** と接続済み集合を持たせる（`audioMerge: GainNode; audioConnected: Set<AudioNode>`）。
- 参照先シーン評価用の env `sceneEnv(sceneId)` を用意：`referencedScene:true`、`captureSceneAudio:(node)=> 一度だけ node.connect(res.audioMerge)`、`sceneTexture`/`sceneAudio` は共有。
- createState（syncStatesFor）も `sceneEnv(sceneId)` を使う（AudioOutput が referencedScene を見て destination 非接続にするため）。
- `sceneAudioCache: Map<sceneId, AudioNode>`：評価後、捕捉があれば `res.audioMerge` を、無ければ未設定。`env.sceneAudio(id) = sceneAudioCache.get(id) ?? null`。
- res 破棄時に audioMerge を disconnect。

### SceneInputNode（`nodes/SceneInputNode.ts`）
- 出力に `audio`（型 `audio`・`SIGNAL_OUTPUT` 相当）を追加。
- evaluate: `texture = env.sceneTexture(sid)`、`audio = signalOutput(env.sceneAudio?.(sid) ?? null).audio`。
- 親グラフで `audio` を AudioMix/AudioOutput へ繋ぐと、参照先の音が親経由で発音・合成される。

## データフロー（1 フレーム・音声）
1. ランタイムが参照先シーンを依存順に評価（sceneEnv で createState/evaluate）。
2. 参照先の AudioFileInput が再生・解析（特徴量で参照先ビジュアルが動く＝A）。
3. 参照先 AudioOutput は destination 非接続、gain を captureSceneAudio で res.audioMerge へ接続（B）。
4. `sceneAudioCache[sceneId] = res.audioMerge`。
5. アクティブ評価で SceneInput が `audio = res.audioMerge` を出力 → 親 AudioMix/AudioOutput が destination へ（発音は親で 1 回）。

## 端ケース
- AudioContext は user gesture で resume（切替・操作時 `resumeAudio`）。復元時 `start()` は gesture 不足なら次回。
- 参照先ファイルが**アセット未登録（assetId 無し）**なら復元不可（#154 で直接選択も登録のため通常は満たす）。映像は静止のまま。
- 参照先に AudioOutput が無ければ `audio` 出力なし（A の無音解析のみ）。
- 多段ネスト：各シーンが own merge を持ち、SceneInput.audio が上位へ伝播（依存順評価で解決）。
- 循環は Phase 1 の `wouldCreateSceneCycle` で引き続き防止（音声経路も同じ参照グラフ）。

## テスト
- `AudioOutputNode`: fake env で `referencedScene=true` 時 destination 非接続・`captureSceneAudio` 呼び出し / 通常時は従来どおり（既存 `audio-routing.test.ts` 等を更新・追加）。
- `SceneInputNode`: `audio` 出力が `env.sceneAudio` を `AudioSignal` で返す（fake env）。texture も維持。
- ランタイムの実評価・実音声・親発音は Playwright スモーク＋手動。

## ファイル
- 変更: `graph/node-type.ts`、`graph/runtime.ts`、`nodes/AudioOutputNode.ts`、`nodes/SceneInputNode.ts`、`main.ts`
- テスト: `nodes/scene-input-node.test.ts`（audio 追加）、AudioOutput 関連テスト更新

## スコープ外
トランジション、参照先シーンの個別音量 UI（参照先の AudioOutput volume がそのまま効く）。
