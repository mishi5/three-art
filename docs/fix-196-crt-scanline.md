# fix #196: CRT の走査線が表示されない

Issue: https://github.com/mishi5/three-art/issues/196

## 原因
`src/apps/node-vj/nodes/CrtNode.ts` の走査線計算が描画バッファ解像度に張り付いていた:

```glsl
float sl = 0.5 + 0.5 * sin(uv.y * uResolution.y * 3.14159265);
```

`uResolution.y` は `ShaderSurface` のレンダーターゲット高（= `renderer.domElement` の物理ピクセル数）。
隣接ピクセル間で sin の位相がちょうど π 進むため、**RT 上で厳密に1px周期の縞**になる（解像度の値に依らず常にそう）。
1px周期の明暗はディスプレイ表示時の縮小・retina ダウンサンプリングで平均化され、一様グレーに潰れて視認できなかった。

## 修正
- 走査線の空間周波数を描画バッファ解像度から切り離し、画面全体に対して一定本数になるようにした。
  ```glsl
  float sl = 0.5 + 0.5 * sin(uv.y * uScanlineCount * 6.28318530718); // 2π → uScanlineCount 本
  ```
- 本数を param `scanlineCount`（default 240, 30〜600, step 10）で調整可能にした。
- `uResolution` はノイズ（ザラつき）では引き続きピクセル単位で使用するため残置。

## テスト
- `crt.test.ts`: param 順序に `scanlineCount` を追加、`uScanlineCount` uniform の既定値（240）を検証。
- GLSL の見た目（走査線が実際に見えること）は実機（node-vj dev サーバ）でユーザ確認。
