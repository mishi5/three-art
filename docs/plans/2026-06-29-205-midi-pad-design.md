# #205 簡易 MIDI パッドノード（MidiPad）設計

対象 Issue: https://github.com/mishi5/three-art/issues/205

## 目的（MVP）

ノード本体に 4×4=16 のパッドグリッドを描く新ノード `MidiPad`（category: "input"）を追加する。

- 空パッドをクリック → ファイル選択ダイアログ → そのパッドに音声ファイルを割り当て（decode して保持）。
- 音入りパッドをクリック → ワンショット発音。クリックのたびに新規 `AudioBufferSourceNode` を生成するため、連続クリックで前の音を切らずに重ねて鳴る。
- 再割当は Shift+クリックで再度ダイアログ。
- 出力ポート audio ×1（全パッドを 1 つの mix gain に合流）。`graph/audio-signal.ts` の `SIGNAL_OUTPUT` / `signalOutput(mixGain)` を使う。
- master volume param（0..1・既定 1）。
- パッドのラベルは短縮ファイル名（拡張子なし、無ければパッド番号）。
- 割当はアセットライブラリで永続化（リロード／#201 プロジェクト保存で復元）。

## スコープ外

trigger 入出力 / パッド毎の個別 volume / キーボード割当 / MIDI デバイス連携。master volume のみ。

## 変更ファイル

### 新規
- `nodes/MidiPadNode.ts`: `MidiPadRuntime`（ctx・mixGain・buffers[16]・fileNames[16]・active source 集合・`loadPadFile`/`playPad`/`hasPad`/`padLabel`/`setVolume`/`dispose`）と `NodeTypeDef MidiPadNode`（`padGrid: {rows:4,cols:4}`・outputs[audio]・params[volume, padAssets(hidden)]・createState/disposeState/evaluate）。純関数 `shortPadLabel`。
- `nodes/MidiPadNode.test.ts`: 定義・shortPadLabel のユニットテスト（6 件）。

### 変更
- `graph/node-type.ts`: `NodeTypeDef` に `padGrid?: { rows; cols }` フラグを追加。
- `editor/layout.ts`: `hasPadGrid`/`padGridMetrics`/`padGridHeight`/`padGridRect`/`padRect`/`padIndexAt` を追加。`nodeHeight` にグリッド分（上マージン＋グリッド本体）を加算。パッドは正方形でノード幅から算出。
- `editor/layout.test.ts`: padGrid 幾何のユニットテスト（5 件）。
- `editor/NodeEditor.ts`: 公開コールバック `onHitPad`/`onAssignPad`/`padCellInfo` を追加。`onDown` で `padIndexAt`→音入りなら発音・空 or Shift なら割当。`drawNode` で 16 パッドを描画（音入り=色付き＋短縮ラベル、空=暗色）。
- `asset/asset-refs.ts`: `AssetRef` に `slot?: number` を追加。`collectAssetRefs` を `params.padAssets`（string[]）対応に拡張（各非空 id を slot=index 付きで集約。単一 assetId は従来どおり slot 無し）。
- `asset/asset-refs.test.ts`: 単一/配列/空/混在のテスト（3 件追加）。
- `nodes/registry.ts`: `MidiPadNode` を input カテゴリに登録。
- `main.ts`: `onHitPad→playPad` / `onAssignPad→ファイルダイアログ→loadPadFile＋library.add で assetId 記録（params.padAssets[slot]）` / `padCellInfo` を配線。`restoreAssets` を slot 対応（slot ありは `loadPadFile`、無しは従来 `loadFile`）。発音/割当時に `runtime.resumeAudio()`。

## データモデル

- `params.padAssets`: `string[]`（hidden・noInput）。index=パッド番号、値=アセット id。既定 `[]`。書き込みは常に slice してから（共有 default 配列を破壊しない）。
- `AssetRef.slot`: 省略＝単一 assetId、数値＝padAssets の slot 番目。

## ランタイム API（duck-type）

- `loadPadFile(index, file): Promise<void>` — decode して buffers[index] に保持。
- `playPad(index): void` — 新規 BufferSource→mixGain→start(0)。ended で active から除去。
- `hasPad(index): boolean` / `padLabel(index): string|null` — UI の状態参照。
- `mixGain: GainNode` — audio 出力（evaluate が `signalOutput(mixGain)` で返す）。

## テスト方針

純ロジック（パッド幾何・座標→index 変換・asset-refs 拡張・shortPadLabel）はユニットテスト。decodeAudioData/発音/UI/ファイルダイアログは headless 検証困難なため手動確認に委ねる。

## 手動確認項目

1. input メニューから MidiPad を追加し、4×4 グリッドが表示される。
2. 空パッドをクリック→ファイル選択→音声を割り当て、ラベル（短縮名）が出る。
3. 音入りパッドをクリックで発音。連打で重ねて鳴る。
4. MidiPad.audio → AudioOutput（または AudioMix）へ繋いで発音できる。
5. Shift+クリックで再割当ダイアログ。
6. リロード／プロジェクト保存・読込でパッド割当が復元される。

---

## 追加機能（既存 MidiPad への 5 機能追加）

基本実装に対し、以下 5 機能を追加した。

### 1. パッドを画面全体に拡大表示

- タイトルバー右端に拡大ボタン（⛶）を追加（`layout.padExpandButtonRect`）。`NodeEditor.onExpandPad?(nodeId)` を発火。
- `editor/pad-overlay.ts`（新規）の `openPadOverlay(nodeId, deps)` が全画面 DOM オーバーレイを開く。暗い背景・大きな 4×4 パッド・Stop ボタン・✕/Esc で閉じる。各パッド click で `deps.play`、Shift+click で `deps.assign`（再割当）。filled/label は `deps.info`。多重オープンは前回を閉じてから開く。対象ノードのみ表示。

### 2. 再生した音を止める

- `MidiPadRuntime.stopAll()`: active 内の全 source を `stop()`+`disconnect()`、`active.clear()`。mixGain は残すので以後も発音可能。
- タイトルバーに全停止ボタン（■・拡大ボタンの左隣 `layout.padStopButtonRect`）。`NodeEditor.onStopPad?(nodeId)` → main で `stopAll()`。オーバーレイにも Stop ボタン。

### 3. 音声ファイルを再割り当て

- filled パッドへの Shift+click 割当が確実に上書きされる（`loadPadFile` は buffers/fileNames を上書き・`recordPadAsset`/ドロップ割当は `padAssets` を slice 後に上書き）。オーバーレイ内でも Shift+click で再割当可。ヒント文言・button.title に明記。

### 4. アセットからドロップで割当

- `NodeEditor.onDrop` を拡張: ドロップ world 位置が MidiPad のパッド上（`padIndexAt`）なら `onDropAssetToPad?(nodeId, padIndex, assetId)` を発火（generic `onDropAsset` の前に判定）。
- main で `library.getFile(assetId)` → `loadPadFile(padIndex, file)`＋`params.padAssets[padIndex]=assetId`（slice 後に書込）。`resumeAudio`。

### 5. パッド押下で発火する trigger 出力

- outputs に trigger 出力ポート（`{ id:"trigger", type:"trigger" }`）を追加。
- `MidiPadRuntime`: `playPad` で押下ラッチ `pressed` を立て、`consumeTrigger()` で読み取り＋リセット。`evaluate` が `{ ...signalOutput(mixGain), trigger: s.consumeTrigger() }` を返す。クリックは非同期・評価は毎フレームなので、押下→次の evaluate で 1 フレームだけ true。trigger は boolean 表現（PulseNode 等と同一）。単一トリガ（どのパッドでも発火）。

### 追加 API

- `NodeEditor`: `onExpandPad?`, `onStopPad?`, `onDropAssetToPad?`
- `MidiPadRuntime`: `stopAll()`, `consumeTrigger()`
- `layout`: `padExpandButtonRect`, `padStopButtonRect`
- `editor/pad-overlay.ts`: `openPadOverlay`, `closePadOverlay`, `PadOverlayDeps`

### 追加機能の手動確認項目

7. ⛶ ボタンで全画面オーバーレイが開き、大きいパッドで発音・Shift+click で再割当・Stop・✕/Esc で閉じる。
8. ■ ボタン（ノード／オーバーレイ）で発音中の音がすべて止まる。
9. アセットパネルの項目をパッド上にドロップで割当（filled パッドは上書き）・リロードで復元。
10. MidiPad.trig → Envelope/Flash/FlipFlop 等へ繋ぎ、パッド押下で 1 フレーム発火する。
