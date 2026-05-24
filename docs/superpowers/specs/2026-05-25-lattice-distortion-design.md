# lattice モード: ベース形状 + 形状歪み 設計

- 対象 Issue: https://github.com/mishi5/three-art/issues/41
- 親仕様 Issue: https://github.com/mishi5/three-art/issues/14
- 作成日: 2026-05-25
- ブランチ: feature/41-lattice-distortion

## 概要

lattice モードに 2 種類の機能を追加する。

1. **ベース形状の選択**: 現状の cube 格子に加え、cube-to-sphere mapping による球体ボリュームを選べるようにする。
2. **形状歪み**: 3D ノイズ warp / 軸変形 (twist/bend/taper) / sin ripple の 3 系統を独立スライダで重ね掛けできる。すべて 0 で「歪みなし」、0 以外で連続的に効く。

既存の bass shockwave (#14) は **歪み後の位置を中心** に重畳する。計算順は固定:

```
basePos(idx)      // cube or sphere
  → 軸変形         // twist → bend → taper
  → ノイズ warp    // 3D simplex で位置オフセット
  → ripple        // sin で位置オフセット
  → shockwave 重畳 // 既存ロジックそのまま、中心は歪み後位置
```

## 方針 (ブレストで確定)

| 観点 | 決定 | 備考 |
|------|------|------|
| ベース形状 | `"cube"` (現状互換 / デフォルト), `"sphere"` の 2 値 | settings の lattice.baseShape を新設 |
| sphere の実装 | cube-to-sphere mapping (Philip Nowell 方式) | 粒子数は cube と同じ、shockwave radial と相性 ◯ |
| ノイズ実装 | shader 内に小型 3D simplex/value noise を直書き | テクスチャ・JS ライブラリ不要、seed uniform で別形状 |
| 軸変形レンジ | 控えめ (twist ±180°、bend ±45°、taper 0.3..1.7) | 画面外飛び出しを抑制、他モードとスケール感を揃える |
| randomize 対象 | 新パラメータ全部を randomize 対象に加える | シンプル方針、「歪みなしロジック」は入れない |
| 計算順序 | 軸変形 → ノイズ → ripple → shockwave | 固定。設定不可 |
| shader 分岐 | lattice ブランチ内に閉じる | 他モード (bones/cube/sphere/image/rain) には影響を出さない |

## アーキテクチャ

### 1. settings 拡張

`LatticeSettings` に以下を追加 (順序は SettingsPanel の表示順)。

```ts
export type LatticeBaseShape = "cube" | "sphere";

export interface LatticeSettings {
  // --- 既存 ---
  resolution: number;
  waveSpeed: number;
  waveAmplitude: number;
  waveOscFreq: number;
  waveDamping: number;
  onsetThreshold: number;
  onsetCooldown: number;

  // --- 追加 (#41) ---
  /** ベース形状。"cube" は現状互換、"sphere" は cube-to-sphere マッピング。 */
  baseShape: LatticeBaseShape;
  /** ノイズ warp の空間周波数 (1/m)。0.1..3.0。 */
  noiseScale: number;
  /** ノイズ warp の振幅 (m)。0..0.5。0 で歪みなし。 */
  noiseAmount: number;
  /** ノイズ warp のシード。1..16 の整数 (UI 上は整数スライダ)。形を変えるためのキー。 */
  noiseSeed: number;
  /** y 軸まわりのねじり角 (rad/m)。-π..+π。0 で歪みなし。 */
  twist: number;
  /** y 軸の曲げ (rad/m)。-π/4..+π/4。0 で歪みなし。 */
  bend: number;
  /** 上下スケール差。0.3..1.7。1.0 で歪みなし。 */
  taper: number;
  /** ripple の空間周波数 (1/m)。0.5..6.0。 */
  rippleFreq: number;
  /** ripple の振幅 (m)。0..0.3。0 で歪みなし。 */
  rippleAmp: number;
}
```

デフォルト値 (歪みなしで現状互換):

```ts
lattice: {
  // 既存維持
  resolution: 12,
  waveSpeed: 1.2,
  waveAmplitude: 0.15,
  waveOscFreq: 4.0,
  waveDamping: 0.4,
  onsetThreshold: 0.15,
  onsetCooldown: 0.12,
  // 追加
  baseShape: "cube",
  noiseScale: 1.0,
  noiseAmount: 0.0,
  noiseSeed: 1,
  twist: 0.0,
  bend: 0.0,
  taper: 1.0,
  rippleFreq: 2.0,
  rippleAmp: 0.0,
}
```

`MOTION_TARGETS` への追加:

```ts
"lattice.noiseAmount",
"lattice.twist",
"lattice.bend",
"lattice.rippleAmp",
```

= motion target で音に反応させたい「歪み量」系のみ。レンジや周波数は対象外。

### 2. shader uniform 追加

```glsl
uniform float uLatticeBaseShape;  // 0=cube, 1=sphere (int だが branch トラップ回避で float)
uniform float uLatticeNoiseScale;
uniform float uLatticeNoiseAmount;
uniform float uLatticeNoiseSeed;
uniform float uLatticeTwist;
uniform float uLatticeBend;
uniform float uLatticeTaper;
uniform float uLatticeRippleFreq;
uniform float uLatticeRippleAmp;
```

### 3. shader 内の計算

lattice ブランチ (`uMode == 3`) に追加。既存 `latticePos` (= 立方体格子位置) の直後に以下を挟む。

```glsl
// (a) cube-to-sphere mapping
vec3 shapePos = latticePos;
if (uLatticeBaseShape > 0.5) {
  // 立方体ボリューム [-uShapeRadius, +uShapeRadius]^3 → 球 (Philip Nowell)
  vec3 n = latticePos / max(uShapeRadius, 1e-5); // [-1, 1]^3 に正規化
  vec3 n2 = n * n;
  vec3 mapped;
  mapped.x = n.x * sqrt(max(1.0 - n2.y * 0.5 - n2.z * 0.5 + n2.y * n2.z / 3.0, 0.0));
  mapped.y = n.y * sqrt(max(1.0 - n2.z * 0.5 - n2.x * 0.5 + n2.z * n2.x / 3.0, 0.0));
  mapped.z = n.z * sqrt(max(1.0 - n2.x * 0.5 - n2.y * 0.5 + n2.x * n2.y / 3.0, 0.0));
  shapePos = mapped * uShapeRadius;
}

// (b) 軸変形: twist → bend → taper
// twist: y に比例した角度で xz 回転
{
  float a = uLatticeTwist * shapePos.y;
  float ca = cos(a); float sa = sin(a);
  shapePos.xz = mat2(ca, -sa, sa, ca) * shapePos.xz;
}
// bend: y に比例した角度で xy 回転 (x を持ち上げ)
{
  float a = uLatticeBend * shapePos.y;
  float ca = cos(a); float sa = sin(a);
  shapePos.xy = mat2(ca, -sa, sa, ca) * shapePos.xy;
}
// taper: 上下で xz スケール (y = +uShapeRadius で taper、y = -uShapeRadius で 1/taper の対数線形)
{
  float t = mix(1.0 / max(uLatticeTaper, 1e-3), uLatticeTaper, 0.5 + shapePos.y / (2.0 * uShapeRadius));
  shapePos.xz *= t;
}

// (c) ノイズ warp
if (uLatticeNoiseAmount > 0.0) {
  vec3 q = shapePos * uLatticeNoiseScale + vec3(uLatticeNoiseSeed * 17.3);
  vec3 offset = vec3(
    snoise(q),
    snoise(q + vec3(31.0, 0.0, 0.0)),
    snoise(q + vec3(0.0, 41.0, 0.0))
  );
  shapePos += offset * uLatticeNoiseAmount;
}

// (d) ripple
if (uLatticeRippleAmp > 0.0) {
  vec3 r = shapePos * uLatticeRippleFreq;
  vec3 ripple = vec3(
    sin(r.y) * cos(r.z),
    sin(r.z) * cos(r.x),
    sin(r.x) * cos(r.y)
  );
  shapePos += ripple * uLatticeRippleAmp;
}

// (e) shockwave 重畳 (中心は歪み後位置)
vec3 outwardDir = normalize(shapePos + vec3(1e-5));
float r = length(shapePos);
float totalDisp = 0.0;
for (int wi = 0; wi < 4; wi++) {
  float t0 = uWaveTimes[wi];
  if (t0 < 0.0) continue;
  float waveAge = (uTime - t0) - r / uWaveSpeed;
  if (waveAge < 0.0) continue;
  float env = exp(-waveAge / uWaveDamping);
  float osc = sin(waveAge * uWaveOscFreq * 6.2831853);
  totalDisp += uWaveAmplitude * env * osc;
}
pos = shapePos + outwardDir * totalDisp;
```

### 4. simplex noise の組み込み

shader 先頭の utility ブロック (現状あれば既存、なければ新設) に Ashima 3D simplex noise (`snoise(vec3)`) を追加。

- ASCII-only (threejs-art skill のトラップ回避)
- `int` uniform は使わない
- 動的 uniform 配列 indexing は使わない

実装は public domain の Ashima Arts 実装をそのまま貼る (約 50 行)。

### 5. UI (SettingsPanel)

現状の `Mode` フォルダは以下の構成 (確認済み):

- `Mode > Shape (cube / sphere)`: shape.radius / shape.bassPulse
- `Mode > Wave (lattice / image 共有)`: lattice.waveSpeed / waveOscFreq / waveDamping / onsetThreshold / onsetCooldown
- `Mode > Lattice`: lattice.resolution / lattice.waveAmplitude
- `Mode > Image`, `Mode > Rain`: 各モード固有

#### 配置方針

- `Mode > Lattice` フォルダの先頭に `baseShape` dropdown を追加 (resolution の前)
- `Mode > Lattice` 配下に新フォルダ `Distortion (shape warp)` を作成し、歪み系 8 パラメータをまとめる

```
Mode > Lattice
  baseShape (dropdown: cube / sphere)   ← 新規 (先頭)
  resolution NxNxN
  wave amplitude (m)
  Distortion (shape warp)               ← 新フォルダ
    noiseScale
    noiseAmount
    noiseSeed (step=1)
    twist (rad/m)
    bend (rad/m)
    taper
    rippleFreq (1/m)
    rippleAmp (m)
```

waveSpeed 等の `Wave (lattice / image 共有)` フォルダはそのまま (歪みとは独立な shockwave 設定群)。

### 6. randomize / param-relevance / param-docs

- `randomize.ts` の `PARAM_RANGES` (もしくは同等) に lattice の新パラメータをそれぞれ追加
  - `baseShape`: `["cube", "sphere"]` から一様乱択
  - `noiseAmount`: 0..0.3 (デフォルト範囲の 60% まで)
  - `noiseScale`: 0.5..2.5
  - `noiseSeed`: 1..16 の整数
  - `twist`: -π..+π
  - `bend`: -π/4..+π/4
  - `taper`: 0.5..1.5
  - `rippleFreq`: 1.0..4.0
  - `rippleAmp`: 0..0.15
- `param-relevance.ts`: 新パラメータは lattice モードでのみ relevant
- `param-docs.ts`: 各パラメータに 1 行説明を追加

### 7. テスト計画

| ファイル | 内容 |
|---------|------|
| `settings.test.ts` | `makeDefaultSettings().lattice.baseShape === "cube"` 等のデフォルト確認 / `MOTION_TARGETS` に新エントリ追加確認 / deepMerge migration で旧 snapshot に新キーが補完されること |
| `ui/randomize.test.ts` | `randomize()` 後に新キーが全てレンジ内に収まること、baseShape が "cube"|"sphere" のいずれかであること |
| `ui/param-relevance.test.ts` | lattice モード時のみ新パラメータが relevant、bones/cube/sphere/image/rain では irrelevant |
| `ui/param-docs.test.ts` (あれば) | 新パラメータに docs キーがあること |
| shader / 視覚 | ユニットテスト不可。worktree で目視確認 |

### 8. 既存 preset への影響

migration 不要。`deepMerge(defaults, stored)` で `baseShape: "cube"`, `noiseAmount: 0`, `twist: 0`, `taper: 1.0`, `rippleAmp: 0` が補完され、視覚的に従来と完全互換。

## 実装順序

| # | 内容 | テスト |
|---|------|--------|
| 1 | LatticeSettings 拡張 + defaults + MOTION_TARGETS | settings.test.ts |
| 2 | randomize / param-relevance / param-docs の更新 | randomize / param-relevance テスト |
| 3 | shader に uniform 追加 + simplex noise 関数 + lattice 分岐に baseShape mapping | (目視) |
| 4 | shader に軸変形 (twist/bend/taper) | (目視) |
| 5 | shader にノイズ warp と ripple | (目視) |
| 6 | shockwave の中心を歪み後位置に変更 (式は同じ) | (目視) |
| 7 | SettingsPanel に新スライダ追加 | (目視) |
| 8 | App.ts で uniforms と settings の連携追加 | (目視) |
| 9 | 全テスト実行 + 全モード回帰目視 | `bun run test` |

## 動作確認シナリオ (PR 後)

- bones / cube / sphere / image / rain の見た目が変わっていない
- lattice モード + 全パラメータ 0 (デフォルト) で従来と同じ立方体格子 + shockwave 挙動
- baseShape を sphere に切り替えると球体ボリュームに変わる
- noiseAmount を上げると粒子が連続的にうねる
- noiseSeed を変えると「別のうねり形」になる
- twist / bend / taper でねじれ・曲げ・先細りが見える
- ripple で凹凸が出る
- shockwave が歪んだ形状に対しても外向きに伝播する
- randomize ボタンを押すと多様な歪み形状が出てくる

## 設計上の非自明な選択 (記録)

- **計算順序を固定** (twist → bend → taper → noise → ripple): UI を出してユーザに順序選択させると組み合わせ爆発になり、テストもプリセット resilience も詰むため固定。「順序を変えたい」場合は別 Issue。
- **noiseSeed は float uniform に整数を入れる**: `int` uniform は threejs-art skill のトラップで分岐失敗の可能性があるため。
- **`MOTION_TARGETS` は "Amount" 系のみ**: scale や frequency を音に反応させると見た目が壊れやすいので入れない。
- **taper の対数線形補間**: 上で `taper`、下で `1/taper` にすることで「上が広がるとき下が狭まる」対称な挙動になり、taper=1 で歪みなしという定義が自然に成り立つ。
- **simplex noise は shader 内に直書き**: テクスチャ依存にすると seed 変更で再アップロードが必要。直書きで uniform 1 つで済む。
