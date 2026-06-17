# #125 AudioFileInput 二重再生バグ修正

対象 Issue: https://github.com/mishi5/three-art/issues/125

## 症状
AudioFileInput で 1 つ目を再生中に 2 つ目のファイルを選ぶと、両方が同時に鳴る。

## 原因
`AudioFileInputRuntime.loadFile()` が、再生中の旧 `this.source`（FileAudioSource）を停止せずに
新 source を生成・差し替えていた。旧 AudioBufferSourceNode が destination に接続されたまま鳴り続ける。

## 修正
`loadFile` 冒頭で `this.source?.stop()` を呼び、`source=null` / `started=false` にリセットしてから
新 source を生成・start する（1 ノード 1 音源）。

## テスト
- `audio-file-dup.test.ts`: 旧 source（stop スパイ）を仕込み loadFile を呼ぶと stop が 1 回呼ばれる
  （bun 環境は AudioContext 不在で後段が throw するが、stop は冒頭で呼ばれる）。
- 実音での重複解消は手動確認に委ねる。

## 補足
VideoFileInput は単一 `<video>` の src 差し替え（旧 objectURL revoke）で旧再生が止まるため二重再生しない。
