# #99 ファイル入力をノードごとに選択・ノード上にファイル名表示

対象 Issue: https://github.com/mishi5/three-art/issues/99

親 Epic: #56 / 関連: #66（VideoFileInput）, #100（AudioInput→AudioFileInput 分割）

## 現状の課題
ファイル選択が画面下部バーの共有 input に集約され、グラフ内の最初の該当ノードに割り当てられる。
どのノードに入ったか分からず、同種ノードが複数あると個別指定できず、読込中のファイル名も見えない。

## 方針（設計判断）
- ファイル選択を**ノード単位**にする。下部バーの共有ファイル input（音声/動画）は**撤去**。
  - mic/camera/display 用の「▶ 入力開始」ボタンは user gesture 起動に必要なので残す。
- 対象ノード: **VideoFileInput** / **AudioFileInput**（#100 で AudioInput[file] から改名済み）。
- ファイル名はランタイム state に保持（ephemeral）。ブラウザのセキュリティ上、保存グラフ読込後に
  File を自動復元できないため、ファイル名を params にシリアライズしない（読込しても実体が無く誤解を招くため）。

## 変更点

### node-type / 各ノード
- `NodeTypeDef` に任意 `fileInput?: { accept: string }` を追加（ファイル選択 UI を出すノードの目印＋accept）。
- `VideoFileInputNode.fileInput = { accept: "video/*" }`、`AudioFileInputNode.fileInput = { accept: "audio/*" }`。
- 各ランタイムに `fileName: string | null = null` を追加し、`loadFile(file)` 冒頭で `this.fileName = file.name` を即セット。

### layout.ts
- `hasFileRow(def)` = `!!def.fileInput`。
- `nodeHeight` を file 行ぶん +ROW_H（fileInput 持ちのみ）。
- `fileRowRect(node, def)`: params の下に置く全幅クリック領域を返す。
- 純関数 `fileRowLabel(name)`: name があれば name、無ければ「ファイル未選択」。

### NodeEditor
- コンストラクタに任意 `loadFileIntoNode?(nodeId, file)` と `getFileName?(nodeId)` を追加。
- 描画: fileInput 持ちノードに file 行を描く（📁 アイコン＋ラベル。長い名は中略）。
- ヒット: node ヒット時に `fileRowRect` 内なら、`<input type=file accept=...>` を生成して `.click()`
  （pointerdown の user gesture 内）→ change で `loadFileIntoNode(nodeId, file)`。ドラッグは開始しない。

### main.ts
- 下部バーの「音声ファイル」「動画ファイル」共有 input を撤去。
- NodeEditor に `loadFileIntoNode: (id, f) => (runtime.getState(id) as FileLoadable)?.loadFile?.(f)` と
  `getFileName: (id) => (runtime.getState(id) as { fileName?: string|null })?.fileName ?? null` を渡す。

## TDD（純粋・テスト可能部分）
1. node defs: `VideoFileInputNode.fileInput?.accept === "video/*"`、`AudioFileInputNode.fileInput?.accept === "audio/*"`。
2. layout: fileInput 持ちは `nodeHeight` が +ROW_H、`fileRowRect` が params 直下の全幅行を返す。fileInput 無しは従来通り。
3. `fileRowLabel`: 未選択→「ファイル未選択」、ファイル名→そのまま。

※ ランタイムの `fileName` セットや実ファイルダイアログは DOM/File 依存のため手動確認に委ねる。

## 追加スコープ: ノードごとの再生コントロール（ユーザー要望でこの Issue に統合）

ノード単位でファイルを持つと、再生/停止・再生位置もノード単位で要る。別 Issue に分けず本 PR に含める。

### 共通インターフェース
`src/apps/node-vj/nodes/playback.ts` に `PlaybackControl`:
- `isPlaying(): boolean` / `togglePlay(): void` / `getCurrentTime(): number` / `getDuration(): number` / `seek(t): void`

両ランタイムが実装:
- AudioFileInputRuntime: `FileAudioSource` の `isPlaying`/`togglePause`/`getCurrentTime`/`getDecodedBuffer().duration`/`seek` に委譲。
- VideoFileInputRuntime: `HTMLVideoElement` の `paused`/`play`/`pause`/`currentTime`/`duration` に委譲。

### レイアウト（layout.ts）
- fileInput 持ちノードは file 行＋transport 行で **+2*ROW_H**。
- `fileRowRect`（上）/ `transportRowRect`（下＝ノード最下行）。
- `transportLayout(rect)` → `{ button, seek }`（再生ボタン＋シークバー）。
- `seekRatioAt(x, seekRect)` → 0..1。`formatTime(sec)` → "m:ss"。

### NodeEditor
- コンストラクタに `playback?: { get(nodeId), toggle(nodeId), seek(nodeId, t) }` を追加。
- transport 行に再生/停止ボタン（▶/⏸）・進捗付きシークバー・時刻を描画。
- ヒット: ボタン→toggle、シークバー→クリック/ドラッグで seek（Drag に "seek" 種別を追加）。

### main.ts
- `playback` を runtime.getState 経由で配線（`PlaybackControl` を持つノードのみ機能）。

### TDD 追加
- layout: nodeHeight +2*ROW_H、transportRowRect/fileRowRect の位置、transportLayout、seekRatioAt、formatTime。

## 動作確認
- VideoFileInput / AudioFileInput をノード上のファイル行クリックで個別に選択し、ノードにファイル名が出る。
- 同種ノードを 2 つ置き、別々のファイルを割り当てられる。
- 各ノードの再生/停止ボタンと再生位置シークが効く。
- 下部バーに共有ファイル input が無いこと。
