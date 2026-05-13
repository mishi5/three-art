# Rain モード設計書 (MVP)

対象 Issue: https://github.com/mishi5/three-art/issues/17

## 目的

新しい描画モード `rain` を pose-particles に追加する。画面上方から雨粒を一様に降らせる平面的なオーディオビジュアルで、スペクトラム形状が雨の落下プロファイルとして可視化される。

本設計書は **MVP (基本の雨描画)** のみを扱う。地面でのスプラッシュは別 Issue。

## 仕様まとめ

| 軸 | マッピング |
|---|---|
| X 位置 | FFT bin index (0..N-1) → 描画域横幅に展開。`binMapping = "linear"` のみ MVP で実装 (log は後続 Issue 候補) |
| Y 位置 | 上端で生成、下端でリスポーンするリングバッファ |
| Z 位置 | bin index に応じて固定 (深さ感のために小さな範囲でランダム散らし) |
| 落下速度 v | `baseSpeed + ampGain * fft[xIndex]` |
| 雫の長さ | 落下速度に比例 (モーションブラー風) |

- pose は無視 (joint anchor / bassExpansion は無効)
- カメラは正面スタート、OrbitControls は維持
- `rain` 選択中は `EdgeOverlay` を自動 OFF (lattice 同じ扱い)
- 既存 PointCloud / FragmentField は非表示

## 設定 (`Settings.rain`)

| key | 型 | 既定 | 範囲 | 説明 |
|---|---|---|---|---|
| `baseSpeed` | number | 0.3 | 0.0–2.0 | 落下基本速度 (m/s) |
| `ampGain` | number | 4.0 | 0.0–20.0 | 振幅 1 あたりの追加速度 (m/s) |
| `count` | number | 4000 | 256–20000 | 雨粒数 (再起動で反映、毎フレーム変更不可) |
| `length` | number | 0.04 | 0.005–0.5 | 雫の基準長 (m) |
| `areaWidth` | number | 2.0 | 0.5–6.0 | 描画域横幅 (m) |
| `areaHeight` | number | 2.4 | 0.5–6.0 | 描画域高さ (m) |
| `binMapping` | string | "linear" | "linear" \| "log" | 周波数→X マップ (MVP は linear 固定動作。log は将来枠) |

## 技術設計

### モジュール: `src/pose-particles/visuals/RainField.ts`

`THREE.LineSegments` + `THREE.ShaderMaterial`。雫 1 本を 2 頂点 (上端と下端) で表現する。

- BufferGeometry attributes (size = `count * 2`):
  - `aXIndex` (float, vertex 共通): 雨粒の bin index
  - `aSeed` (float, vertex 共通): 0..1 ランダム (Y0 オフセット、Z スプレッド)
  - `aTip` (float, vertex 共通): 0=雫の上端 / 1=雫の下端
- Uniforms:
  - `uTime` (float)
  - `uFft` (sampler2D, 1×Nbin の DataTexture、毎フレーム更新)
  - `uFftLen` (float) — Nbin
  - `uBaseSpeed` (float)
  - `uAmpGain` (float)
  - `uLength` (float)
  - `uAreaWidth` (float)
  - `uAreaHeight` (float)
  - `uColor` (vec3)
- Vertex shader 概要 (擬似コード):
  ```glsl
  float v = uBaseSpeed + uAmpGain * sampleFft(aXIndex);
  float y0 = (aSeed - 0.5) * uAreaHeight; // 個体差
  float y = mod(y0 - v * uTime, uAreaHeight) - uAreaHeight * 0.5;
  // tip 側はさらに長さ分だけ下にずれる
  y -= aTip * uLength * (v / max(uBaseSpeed + uAmpGain * 0.2, 1e-3));
  float x = (aXIndex / max(uFftLen - 1.0, 1.0) - 0.5) * uAreaWidth;
  float z = (fract(aSeed * 7.319) - 0.5) * 0.1;
  ```
- DataTexture は `THREE.DataTexture(Float32Array, N, 1, RedFormat, FloatType)` で作る (`renderer.capabilities.isWebGL2` 前提)。`needsUpdate=true` を毎フレーム立てる。

### 単体テスト方針

GLSL を直接テストするのは難しいので、TypeScript 側の「決定的ロジック」だけテスト化する:

- `binIndexToX(binIndex, fftLen, areaWidth)` — bin index と幅から X 座標を計算する pure function を分離してテスト。
- `expectedRainSpeed(baseSpeed, ampGain, amp)` — 速度計算式を pure function 化。

ShaderMaterial と DataTexture の build は jsdom + bun:test では実機 GL が無いため省略 (既存 lattice/twist の方針に揃える)。

### App.ts 統合

- `pointCloud.object3D.visible = mode !== "rain"`
- `fragmentField.object3D.visible = mode === "bones"` (現状維持)
- `rainField.object3D.visible = mode === "rain"`
- 毎フレーム `rainField.update(audio, live, t)` を呼ぶ
- mode 切替時のカメラリセット: rain は正面スタートしたいので `targetZ = 1.5` 程度
- `EdgeOverlay.update` 内で `mode === "rain"` も off ガード

### Settings の更新漏れ防止

- `cloneSettings` に `rain: { ...s.rain }` を追加
- `applyMotionTo`: 当面 rain はモーション連携対象に含めない (MVP)。将来 `rain.ampGain` を MOTION_TARGETS に追加する余地は残す
- `RenderMode` literal に `"rain"` 追加 / `RENDER_MODES` に追加 / `modeToInt("rain") = 4`

## テスト計画

`settings.test.ts` 拡張:
1. `RENDER_MODES` が 5 件で `"rain"` を含む
2. `modeToInt("rain") === 4`
3. `makeDefaultSettings().rain` が定義され、各 key が想定範囲

`visuals/rain.test.ts` (新規):
1. `binIndexToX(0, 8, 2.0)` が `-1.0` 付近
2. `binIndexToX(7, 8, 2.0)` が `+1.0`
3. `expectedRainSpeed(0.5, 4.0, 0)` === `0.5`
4. `expectedRainSpeed(0.5, 4.0, 0.5)` === `2.5`

`cloneSettings` の更新確認は既存テストが無いので、簡易な App テストではなく、目視チェック + lattice 同様のレビューで担保。

## 対象外

- スプラッシュ表現 (別 Issue)
- log 周波数マッピングの本実装 (MVP は linear のみ動作)
- Pose との衝突
- 雨の色のオーディオ反応 (MVP は固定色)
