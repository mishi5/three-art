# image 描画モード (画像粒子化 + 音声反応 3D 歪み) 設計

- 対象 Issue: https://github.com/mishi5/three-art/issues/18
- 作成日: 2026-05-14
- ブランチ: feature/18-image-mode

## 概要

任意の画像をロードして粒子化し、音声反応で 3D に歪ませる新描画モード `image` を追加する。
pose 独立で、カメラ前に人がいなくても VJ 的に成立するソースを提供する。

既存 4 モード:
- `bones` / `cube` / `sphere` … 関節クラスタ・シェル系
- `lattice` … 体積格子 + bass shockwave

`image` は「2D 画像平面 + 音声反応 3D 変形」という新カテゴリ。

## ブレストで確定した方向性

| 観点 | 決定 |
|------|------|
| pose との関係 | 独立 (joint anchor / pose 変形は適用しない) |
| 画像ソース | `public/images/presets/` の固定プリセット + ローカルアップロード両対応 |
| 粒子化方式 | グリッドサンプリング (gridW × gridH を ImageData からリサンプル) |
| 色 | 画像セルの RGB をそのまま粒子色として保持 |
| 3D 動き | (1) Z 押し出し (レリーフ) (2) ノイズ歪み (3) 中心波動 を合成 |
| 音声マッピング | bass onset → 中心波動 / 中高域 → Z 押し出し / 全体音量 → ノイズ振幅・速度 |
| 中心定義 | 画像平面の幾何中心 (NDC 原点) |
| 波動の実装 | 既存 lattice の OnsetDetector + waveTimes uniform を流用 |
| EdgeOverlay | image 時は自動 OFF (lattice と同じ扱い) |

## アーキテクチャ

### 1. 全体像

- `RenderMode` を 5 値に拡張 (`"bones" | "cube" | "sphere" | "lattice" | "image"`)
- `modeToInt(image) = 4`、shader の `uMode` 分岐に新 branch を追加
- 既存の twist / outlier / shimmer / blur / motion target は image にもかかる (共通処理)
- `EdgeOverlay` は image 時に描画スキップ (グリッドの k-NN は無意味なため)
- 既存の `lattice.wave*` uniform をそのまま流用するので、新規 audio uniform は `uMid` だけ追加
- 画像差し替え時の粒子色は `aColor` attribute を毎回書き直す

### 2. 粒子バッファ

粒子総数 = NUM_JOINTS (13) × POINTS_PER_JOINT (400) = 5200 個 (現状維持)。

新規 attribute `aColor: vec3` (length = total) を BufferGeometry に追加。

- 初期値は `(1, 1, 1)` (白)。image 以外のモードでは未使用
- 画像ロード時に `gridW * gridH` 個分に RGB を書き込み、それ以外は (1,1,1) のまま
- gridW × gridH は 5200 以下に制限 (超過した場合は GUI 側でクランプ)

`aIndex` (既存、0..total-1) を流用してグリッド座標を計算。

### 3. 画像ローダ

新規ファイル `src/pose-particles/visuals/ImageSampler.ts`:

```ts
export interface ImageGrid {
  /** RGB を [0..1] 範囲で gridW * gridH * 3 個並べた配列 */
  colors: Float32Array;
  /** 画像のアスペクト比 (W/H)、平面サイズ計算に使う */
  imageAspect: number;
}

/**
 * HTMLImageElement を gridW × gridH の RGB Float32Array に変換する。
 * オフスクリーン canvas で drawImage → getImageData してリサンプリングする。
 */
export function sampleImageToGrid(
  image: HTMLImageElement,
  gridW: number,
  gridH: number,
): ImageGrid;
```

- Bun のテスト環境で実行できるよう、入力は ImageData っぽい構造体を受ける別関数
  `sampleImageDataToGrid(rgba: Uint8ClampedArray, srcW: number, srcH: number, gridW, gridH)`
  を内部に持ち、`sampleImageToGrid` はそれを薄くラップする
- このピュア関数だけテストする (色平均ロジック、境界、アスペクト計算)

### 4. shader displacement

新規 uniform:

```glsl
uniform float uMid;             // 中域 0..1 (新規)
uniform float uImageGridW;
uniform float uImageGridH;
uniform float uImagePlaneW;     // 画像平面の幅 (m)
uniform float uImagePlaneH;     // 画像平面の高さ (m)
uniform float uImagePushAmount; // Z 押し出しゲイン
uniform float uImageNoiseAmp;
uniform float uImageNoiseScale;
uniform float uImageNoiseSpeed;
uniform float uImageWaveStrength; // image 専用波動振幅 (lattice と独立に調整できる)

attribute vec3 aColor;
```

image branch (`uMode > 3.5`):

```glsl
int idx = int(aIndex + 0.5);
int gridW = int(uImageGridW + 0.5);
int gridH = int(uImageGridH + 0.5);
int total = gridW * gridH;
if (idx >= total) {
  pos = vec3(0.0);
  visAlpha = 0.0;
} else {
  int ix = idx - (idx / gridW) * gridW;
  int iy = idx / gridW;
  float u = (float(ix) + 0.5) / float(gridW);
  float v = (float(iy) + 0.5) / float(gridH);
  // 画像座標 (y は下方向正) → 世界座標 (y 上向き) に反転
  vec3 imagePos = vec3((u - 0.5) * uImagePlaneW, (0.5 - v) * uImagePlaneH, 0.0);

  // (1) Z 押し出し (中高域 × 輝度)
  float lum = dot(aColor, vec3(0.299, 0.587, 0.114));
  imagePos.z += lum * (uMid + uTreble) * uImagePushAmount;

  // (2) 中心からの shockwave (lattice と同式、半径は平面内)
  float r = length(imagePos.xy);
  vec2 outDir = normalize(imagePos.xy + vec2(1e-5));
  float totalDisp = 0.0;
  for (int wi = 0; wi < 4; wi++) {
    float t0 = uWaveTimes[wi];
    if (t0 < 0.0) continue;
    float waveAge = (uTime - t0) - r / uWaveSpeed;
    if (waveAge < 0.0) continue;
    float env = exp(-waveAge / uWaveDamping);
    float osc = sin(waveAge * uWaveOscFreq * 6.2831853);
    totalDisp += uImageWaveStrength * env * osc;
  }
  imagePos.xy += outDir * totalDisp;

  // (3) 安価な smooth noise で XYZ を揺らす (uVolume でスケール)
  vec3 ns = imagePos * uImageNoiseScale + vec3(uTime * uImageNoiseSpeed);
  vec3 noise = vec3(
    sin(ns.x * 1.7 + ns.y * 2.3),
    sin(ns.y * 1.9 + ns.z * 2.1),
    sin(ns.z * 2.5 + ns.x * 1.3)
  );
  imagePos += noise * uImageNoiseAmp * uVolume;

  pos = imagePos;
  visAlpha = 0.95;
}
```

色出力 (vColor 計算の最後で分岐):

```glsl
if (uMode > 3.5) {
  // image: 粒子色は画像セルの RGB をそのまま使う
  vColor = aColor * (1.0 + uTreble * uTrebleBoost);
} else {
  // 既存パス
  float hue = ...; vColor = hsv2rgb(...);
}
```

注意点 (threejs-art skill に記録された罠を回避):
- 静的ループ境界 4 で WebGL1/2 とも安全 (動的 uniform array index 回避)
- `aColor` は通常 attribute、`uMode > 3.5` を bool でなく float 比較

### 5. settings / UI

新規 `Settings.image`:

```ts
export interface ImageSettings {
  /** プリセット選択 (public/images/presets/ 配下のファイル名)。"" 時は最後にアップロードされた blob を使う */
  preset: string;
  /** グリッド W (8..120)。gridW * gridH <= 5200 になるよう GUI 側でクランプ */
  gridW: number;
  /** グリッド H (8..120) */
  gridH: number;
  /** Z 押し出しゲイン (0..2) */
  pushAmount: number;
  /** ノイズ歪み振幅 (0..0.5) */
  noiseAmp: number;
  /** ノイズ空間スケール (0.5..8) */
  noiseScale: number;
  /** ノイズ時間スケール (0..3) */
  noiseSpeed: number;
  /** 中心波動振幅 (0..0.5) */
  waveStrength: number;
}
```

デフォルト値:

```ts
image: {
  preset: "presets/sample-01.png",   // 起動時に自動ロードするプリセット
  gridW: 80,
  gridH: 60,
  pushAmount: 0.5,
  noiseAmp: 0.05,
  noiseScale: 2.0,
  noiseSpeed: 0.5,
  waveStrength: 0.15,
}
```

- `MOTION_TARGETS` に `"image.pushAmount"` / `"image.noiseAmp"` / `"image.waveStrength"` を追加
- `SettingsPanel` に `Image (image mode)` フォルダを追加
  - preset: dropdown (動的に `public/images/presets/index.json` から取得 or 静的リスト)
  - upload: file input ボタン (`.png .jpg .jpeg .webp`)
  - gridW / gridH: slider (8..120、変更時 5200 超過なら反対側をクランプ)
  - pushAmount / noiseAmp / noiseScale / noiseSpeed / waveStrength: slider
- 画像 state は `App` 側で `currentImage: HTMLImageElement` として保持し、Settings に直接シリアライズしない
  - preset 変更 → 新しいプリセット画像をロード → PointCloud に再注入
  - upload → Object URL の HTMLImageElement を生成 → PointCloud に再注入 (`preset = "(uploaded)"` でマーク)

### 6. プリセット画像

`public/images/presets/` に最低 2 枚同梱:
- ライセンス的にクリアな素材 (CC0 / 自作)
- 当面は SVG をプログラム生成して PNG にラスタライズした合成画像で済ませる (実装容易性とリポサイズ抑制)
- 候補: グラデーション + 幾何模様、ストライプ + サークル

`public/images/presets/index.json` で一覧を持たせ、SettingsPanel の dropdown から参照する。

### 7. EdgeOverlay の image ガード

```ts
if (settings.mode === "lattice" || settings.mode === "image") {
  this.object3D.visible = false;
  return;
}
```

### 8. cloneSettings / applyMotionTo

App.ts:

```ts
function cloneSettings(s: Settings): Settings {
  return {
    ...
    image: { ...s.image },
    ...
  };
}

function applyMotionTo(s, target, factor) {
  switch (target) {
    ...
    case "image.pushAmount":   s.image.pushAmount *= factor; break;
    case "image.noiseAmp":     s.image.noiseAmp *= factor; break;
    case "image.waveStrength": s.image.waveStrength *= factor; break;
  }
}
```

### 9. カメラ初期距離 (App.ts mode change snap)

image モード時のカメラ Z は `shape.radius` を基準にした距離。
`Math.max(2.0, this.settings.shape.radius * 3.0)` を流用する (cube/sphere と同じ式)。

## テスト計画

1. `settings.test.ts` (既存に追記)
   - `RENDER_MODES.length === 5` かつ `"image"` を含む
   - `modeToInt("image") === 4`
   - `makeDefaultSettings().image` の各キー (gridW, gridH, pushAmount, noiseAmp, noiseScale, noiseSpeed, waveStrength) が妥当な範囲
   - `MOTION_TARGETS` に `"image.pushAmount"` / `"image.noiseAmp"` / `"image.waveStrength"` を含む

2. `ImageSampler.test.ts` (新規)
   - 4x4 の単色 ImageData を 2x2 にダウンサンプル → 全セル同色
   - 2x2 のチェッカー ImageData を 2x2 で取り出し → 各セル正しい色
   - 8x4 を 4x4 でアップ・ダウンサンプル → 出力長 = gridW * gridH * 3
   - imageAspect 計算 = srcW / srcH

3. shader 側は GPU ロジックのためユニットテスト不可 → 目視で確認

4. 既存 125 件は全パス維持

## 実装順序

| # | 内容 | テスト |
|---|------|--------|
| 1 | RenderMode "image" 追加 + modeToInt + ImageSettings + defaults + MOTION_TARGETS | settings.test.ts |
| 2 | ImageSampler 実装 (純関数 sampleImageDataToGrid) | ImageSampler.test.ts |
| 3 | PointCloud に aColor attribute と uMid / uImage* uniform、image branch shader 追加 | (目視) |
| 4 | PointCloud に `setImage(grid: ImageGrid)` メソッド追加で aColor / uImageGridW / uImageGridH / uImagePlaneW / uImagePlaneH を更新 | (目視) |
| 5 | App.ts でプリセット初期ロード + 画像差替え動線 + cloneSettings / applyMotionTo 拡張 | (目視) |
| 6 | EdgeOverlay の image ガード | EdgeOverlay.test.ts |
| 7 | SettingsPanel: Image フォルダ + アップロード + preset dropdown | (目視) |
| 8 | public/images/presets/ にプリセット 2 枚 + index.json | (目視) |
| 9 | 全テスト実行 + 既存モード回帰目視 | bun test |

## 動作確認シナリオ (PR 後)

- bones / cube / sphere / lattice の挙動が変わっていない
- image に切り替えるとデフォルトプリセット画像が粒子化されて表示される
- 別プリセットへの dropdown 切替で画像が差し替わる
- ローカル PNG / JPG をアップロードすると粒子の色と内容が差し替わる
- 音声入力時に Z 押し出し (レリーフ) / ノイズ歪み / 中心波動 の 3 つが視覚的に確認できる
- twist / blur / outlier / motion target が image で機能する
- EdgeOverlay は image 時に表示されない
- 5200 を超えるグリッド (例: 80×80 = 6400) は GUI 上でクランプされる

## YAGNI で除外する項目

- 動画ソース対応 (将来 Issue 化)
- 複数画像の同時表示 / クロスフェード (将来)
- 画像のカメラフィード入力 (pose 独立とはいえ単純すぎない、別 Issue)
- 単色 / 画像色の切替 (画像色固定で十分、別ヒューシフトはモーション target で代替可)
- 高度なノイズ (Simplex 3D 等): sin 合成 smooth noise で十分視覚的に成立
- GPU FBO ベースのリアルタイム画像処理 (フェードイン等): 静的画像で十分
