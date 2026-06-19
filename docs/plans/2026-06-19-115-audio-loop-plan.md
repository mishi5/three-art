# #115 AudioFileInput に loop ON/OFF 切り替えを追加

対象 Issue: https://github.com/mishi5/three-art/issues/115

親 Epic: #56 / 踏襲: VideoFileInput の loop 実装

## 現状
- `FileAudioSource.spawnSource()` は `src.loop = true` 固定。`computeCurrentTime` も曲長で wrap し実質常にループ。
- `AudioFileInputNode` に loop param が無い。VideoFileInput は `loop`(on/off, default on) param ＋ `setLoop()`。

## 変更
- `FileAudioSource`:
  - `private loop = true` ＋ `setLoop(loop: boolean)`（`this.loop` 更新、再生中 source があれば `source.loop` も反映）。
  - `spawnSource()` で `src.loop = this.loop`。
  - `computeCurrentTime(..., loop = true)` に引数追加（**既定 true で後方互換**）。loop=false は曲末で `duration` に
    張り付く（wrap しない）。`getCurrentTime` / `pause` は `this.loop` を渡す。
- `AudioFileInputNode`:
  - `AudioFileInputRuntime` に `loop` 保持 ＋ `setLoop(loop)`（source に反映, loadFile 後も適用）。
  - params に `{ id:"loop", kind:"enum", default:"on", options:["on","off"] }` を追加（VideoFileInput と同形）。
  - evaluate で `s.setLoop(ctx.param("loop") !== "off")`。

## TDD
- `computeCurrentTime`: loop=true は従来どおり wrap、loop=false は曲末で duration クランプ（既存5引数テストは default true で不変）。
- `AudioFileInputNode`: `loop` param（enum on/off, default on）を持つ。
- 実音の loop 挙動は手動確認。

## 影響
- 既定 loop=true なので既存挙動・テストは不変。
