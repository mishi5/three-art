# #241 VideoFileInput fade パラメータ設計

Issue: https://github.com/mishi5/three-art/issues/241

## 目的

`VideoFileInput` に映像と音を **1 つのつまみで同時にフェード**させる param `fade` を追加する。
VJ のトランジション（素材をゆっくり出す/引っ込める）を Envelope/Sine 等の number 出力からも駆動できるようにする。

## 仕様（ユーザ決定: 黒へフェード）

- param `fade`: number・0..1・step 0.01・既定 1
  - 数値 param なので `paramInputs()`（node-ports.ts）により自動的に入力ポート化され、他ノードから駆動可能。
- **映像**: 出力 texture の輝度を fade で乗算（0=黒、1=そのまま）。
  - `VideoTextureSurface`（contain 描画）の `MeshBasicMaterial.color` を `(fade, fade, fade)` にする。
    `MeshBasicMaterial.color` は `map` と乗算されるため、輝度乗算＝黒フェードになる。
  - `VideoTextureSurface` は CameraInput / DisplayInput とも共用のため、`render(renderer, video, fade = 1)`
    と省略可能引数にして後方互換を保つ（既定 1.0 で従来と同一描画）。
- **音声**: audio 出力経路の GainNode（`VideoFileInputRuntime.gain`＝signal 出力ノード）の
  `gain.gain` に fade を反映する。クリックノイズを避けるため `setTargetAtTime`（時定数 30ms）で滑らかに変化させる。
  - 音響特徴量（volume/bass/…）は `analyzer.input`（gain より上流）で解析するため fade の影響を受けない。
    フェード中も onset 等の特徴量は生きる（フェードは「出音」のみに掛かる）。
  - extractAudio=off / 音声グラフ未構築時は no-op（`<video>` は muted なのでそもそも無音）。
- **後方互換**: 既定 1 で映像色 (1,1,1)・gain 1 → 既存グラフの見た目/音は不変。

## 変更ファイル

- `src/apps/node-vj/nodes/video-fade-logic.ts`（新規）: `FADE_PARAM` 定義・`clampFade()`・`readFade()`・`FADE_SMOOTH_TIME`
- `src/apps/node-vj/graph/video-surface.ts`: `setFade()` 追加・`render()` に fade 引数（省略時 1）
- `src/apps/node-vj/nodes/VideoFileInputNode.ts`: params に fade 追加・evaluate で映像/音へ反映・`setFade()`
- `src/apps/node-vj/nodes/video-fade.test.ts`（新規）: クランプ・param 定義・入力ポート化・surface 色反映
- `src/apps/node-vj/nodes/video-audio.test.ts`: params 一覧テストに fade を追加

## テスト方針（TDD）

純粋部分をテストする（実映像/実音は手動確認）:

- `clampFade`: 0..1 クランプ・NaN/非有限→1（既定）
- `readFade`: 未設定→1・文字列数値の変換・クランプ
- `FADE_PARAM`: kind number / 0..1 / step 0.01 / 既定 1 / noInput でない（=入力ポート化される）
- `paramInputs(VideoFileInputNode)` に fade が含まれる
- `VideoTextureSurface.setFade`: material.color が (f,f,f) になる・クランプされる・既定 1
- evaluate: state 無しでも fade param があっても安全

## 手動確認項目

- fade スライダで映像の明るさと音量が同時に変わる（0 で黒＋無音、1 で原状）
- Envelope/Sine の number 出力を fade へ接続して自動フェードできる
- fade=1 のまま既存グラフ（CameraInput/DisplayInput 含む）の見た目/音が変わらない
- フェード時にクリックノイズが出ない
