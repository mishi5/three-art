# #220 / #221 VideoFileInput 復元フロー修正

対象 Issue:
- https://github.com/mishi5/three-art/issues/220 
- https://github.com/mishi5/three-art/issues/221 

## 背景

`VideoFileInput` / `AudioFileInput` はアセット割当（`params.assetId`）を持ち、
グラフ読込後に `restoreAssets()`（`main.ts`）がライブラリからファイルを復元して `loadFile()` する。
`loadFile()` は仕様上、読み込んだファイルを先頭から自動再生する。

2 つの不具合が同じ初期/切替復元フローに起因していた。

### #220 初期表示時にファイル未読込

`main.ts` の savedSceneSet 初期復元経路が

```
replaceGraph(graph, ...) → restoreAssets()
```

の順で、間に `runtime.ensureStates()` が無かった。`restoreAssets()` は
`runtime.getState(nodeId)` から `loadFile` を呼ぶが、state 未生成のため
`cur` が undefined になり何も読み込めない。
シーン切替の `reflectActiveScene()` は `ensureStates()` の後に `restoreAssets()` を呼ぶため、
「一度シーンを切り替えて戻ると初めて読み込まれる」挙動になっていた。

### #221 シーンを切替えて戻ると勝手に再生される

`restoreAssets()` 内の `loadFile()` が auto-play するため、切替復帰で初回読込が走ると再生が始まる。
プロジェクト読込時は `pauseActivePlayback()`（#201）で止めていたが、
シーン切替・初期復元経路では呼ばれていなかった。

## 方針（読込は最初から行い、復元由来の auto-play はしない）

1. **#220**: 初期復元経路に `runtime.ensureStates()` を追加し、`reflectActiveScene` と手順を揃える。
2. **#221**: `restoreAssets()` で**新規に読み込んだ**（`cur.fileName` が無かった）Video/Audio を、
   `loadFile()` 直後に PlaybackControl duck-type で停止する。
   - state 移譲で既読込のノード（`cur.fileName` あり）は `restoreAssets` が上部で `continue` してスキップ済み＝触らない。
     よって**切替前の再生/停止状態は維持**される。
   - 停止ロジックは `nodes/playback.ts` に `stopIfPlaying(state)` として切り出し、
     `pauseActivePlayback()`（#201）とも共有・単体テスト可能にする。

## 変更ファイル

- `src/apps/node-vj/nodes/playback.ts`: `stopIfPlaying()` を追加。
- `src/apps/node-vj/main.ts`:
  - 初期復元経路に `runtime.ensureStates()` を追加（#220）。
  - `restoreAssets()` の loadFile 直後に `stopIfPlaying(cur)`（#221）。
  - `pauseActivePlayback()` を `stopIfPlaying` に置き換え（重複ロジック集約）。
- `src/apps/node-vj/nodes/playback.test.ts`: `stopIfPlaying` の単体テスト。

## 検証

- 単体: `stopIfPlaying` が再生中→togglePlay 1 回、停止中→呼ばない、非 PlaybackControl→無害 を確認。
- 手動（headless 困難のため）:
  - アセット割当済みシーンを保存→リロードで初期表示時に読み込まれている（#220）。
  - 一時停止中の VideoFileInput がシーン切替→復帰後も再生を始めない・切替前の再生/停止が維持（#221）。
