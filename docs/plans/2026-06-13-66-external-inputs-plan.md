# 実装計画: 外部入力拡張ノード（カメラ映像 / 動画ファイル）

- 対象 Issue: https://github.com/mishi5/three-art/issues/66
- 親 Epic: https://github.com/mishi5/three-art/issues/56
- 前提: #76（texture チェーン）/ #79（previewSource）。OSC は対応範囲外（ユーザ判断）

## 確定方針（#66 ブレインストーミング）

- **案A: CameraInput に統合**。出力 texture + pose + motion。param `poseDetect`(on/off,
  既定 on) で MediaPipe の起動を制御（off なら映像のみ・姿勢推定コストゼロ）、
  `skeleton`(off/on) はプレビュー重畳（#79 踏襲）
- **PoseInput は廃止**。旧名の自動読み替えは不要（プリセットはテストレベルのみ・ユーザ判断）
- **VideoFileInput**: 動画ファイル → texture。param `loop`(on/off, 既定 on)。
  音声トラックは対象外（音は AudioInput.file）。ファイル選択は下部バーに追加
- texture 化は THREE.VideoTexture（カメラ/動画共通）

## 実装

1. core/pose/PoseInput: 既存 video を受け取れるよう start(video?) を拡張
   （CameraInput がカメラを所有し、姿勢推定を後から有効化できるように）
2. nodes/CameraInputNode（PoseInputNode を置換）: camera 起動と MediaPipe を分離、
   poseDetect=on で遅延起動。VideoTexture を texture 出力。previewSource は #79 踏襲
3. nodes/VideoFileInputNode: loadFile(user gesture)・loop param・VideoTexture 出力・
   previewSource
4. registry 差し替え・main の起動/ファイルバーに「動画ファイル」追加
5. テスト更新（PoseInput 参照→CameraInput）＋新ノード定義テスト
6. Playwright: VideoFileInput はファイル投入で texture 表示まで確認可能（合成動画）。
   カメラはユーザ確認
