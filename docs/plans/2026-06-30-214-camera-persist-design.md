# #214 起動したカメラをシーン切替で勝手にオフにしない（共有・永続化＋明示停止）

Issue: https://github.com/mishi5/three-art/issues/214

## 問題

`CameraInputRuntime.dispose()`（`nodes/CameraInputNode.ts`）が getUserMedia のストリームを
`track.stop()` で止める。dispose は `disposeState` 経由で、カメラシーンが「編集中(active)でも
参照先でもない」状態になった瞬間（`renderReferencedScenes` の sceneRes 破棄や `syncStates` の
state 破棄）に呼ばれる。カメラ画像を SceneInput 参照した出力シーン運用で、参照が外れると
カメラが落ちてしまう。

## 望ましい挙動（停止ポリシー＝両方）

一度「入力開始」でカメラを起動したら、シーン切替に関係なくカメラ stream を生かし続ける
（pose 推定は従来どおり poseDetect/可視性で遅延起動/停止してよいが、カメラ stream は止めない）。
stream を止めるのは次の 3 条件のみ:

1. 全シーンから CameraInput ノードが無くなったら自動停止（最後のカメラノード削除で解放）。
2. 明示的な「入力停止」ボタン（「入力開始」と対になる停止操作）。
3. ページ unload/pagehide 時（リーク防止）。

## 設計

### 共有カメラ（所有者の移動）

`nodes/shared-camera.ts` に `SharedCamera` を新設し、`MediaStream` と隠し `<video>` を
**モジュール単一資源**として保持する（`export const sharedCamera`）。per-state ライフサイクル
（`CameraInputRuntime`）から切り離す。

- `start()`: 冪等。起動済み/起動中なら再取得しない（`startPromise` を共有）。
- `stop()`: トラックを `stop()` して解放し `stream=null`・`video.srcObject=null`。video 要素は
  再利用のため残す。
- `started`: stream が生きているか。

各 `CameraInputRuntime` は stream/video を所有せず `sharedCamera` にアタッチするだけ:
- `start()` → `sharedCamera.start()`。
- `getTexture` / `previewFrame` / `ensurePose` は `sharedCamera.video` を参照。
- `dispose()` は pose 停止・surface/previewCanvas 破棄のみ。**stream は止めない**。

1 物理カメラを複数 CameraInput ノードが共有しても、単一 video/stream を参照するだけで破綻しない。
pose 推定は従来どおりノード単位（`PoseInput`）で、共有 video を入力にする。

### 共有カメラの停止配線（main.ts）

- 「■ 入力停止 (camera)」ボタンを「入力開始」と対で追加 → `sharedCamera.stop()`。
- 自動停止: 全シーンの GraphDoc に CameraInput ノードが 1 つも無くなったら停止。
  判定は純関数 `shouldAutoStopCamera(graphs, cameraStarted)` に切り出しテストする。
  収集する graphs は「アクティブシーンは編集中の live `graph`、他は sceneManager の保持分」。
  呼び出し箇所: ノード削除（editor の `onGraphMutated` コールバック）・シーン
  切替/追加/複製/削除・プロジェクト読込。
- `window` の `beforeunload` / `pagehide` で `sharedCamera.stop()`（トラック解放）。

### 純ロジック（テスト対象）

`nodes/camera-share-logic.ts`:
- `anyGraphHasCameraInput(graphs)`: いずれかの GraphDoc に CameraInput ノードがあるか。
- `shouldAutoStopCamera(graphs, cameraStarted)`: 稼働中 かつ 全シーンに CameraInput 無し。

## テスト方針

実カメラ・MediaPipe・getUserMedia は headless 検証不可＝手動確認。純ロジックのみ自動テスト
（`nodes/camera-share-logic.test.ts`）。既存 `input-nodes.test.ts` の CameraInput ポート/params/
no-state evaluate は維持する。

## 手動確認

1. CameraInput を置いて「入力開始」→ 映像が出る。
2. 別シーンを SceneInput でカメラシーン参照し、出力シーンに切替 → カメラが落ちない。
3. カメラノードを含むシーンを離れても stream 継続。
4. 全シーンから CameraInput を削除 → 自動でカメラ停止（LED 消灯）。
5. 「入力停止」ボタン → カメラ停止。再度「入力開始」で復帰。
6. ページを閉じる/リロード → トラック解放（LED 消灯）。
