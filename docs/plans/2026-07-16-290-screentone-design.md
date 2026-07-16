# #290 ScreenTone エフェクトノード設計

対象 Issue: https://github.com/mishi5/three-art/issues/290

## 概要

漫画のスクリーントーン風エフェクト（texture→texture）。入力画像の輝度に応じて
網トーン（ハーフトーンドット）・多線トーン（平行線）・クロスハッチを使い分ける。
既存 effect ノードの流儀（`EFFECT_ENABLED_PARAM` バイパス #134・ShaderSurface・
ASCII のみの GLSL・float uniform の if 連鎖分岐）に従う。

## ノード定義

- `type: "ScreenTone"`, `category: "effect"`, `isSink: true`
- inputs: `in`（texture）／ outputs: `texture`
- params:

| id | kind | default | 範囲 | 説明 |
|---|---|---|---|---|
| enabled | enum | on | on/off | #134 共通バイパス |
| mode | enum | auto | auto/dot/line/cross | トーン種の選択 |
| scale | number | 120 | 20–400 (step 1) | 画面高さあたりのセル数 |
| angle | number | 45 | 0–180 (step 1) | トーンの角度（度） |
| gamma | number | 1 | 0.2–3 (step 0.05) | 輝度応答 L = pow(L, gamma) |
| color | enum | mono | mono/color | mono=白地に黒インク / color=インクに元色 |
| mix | number | 1 | 0–1 (step 0.01) | 元画像とのブレンド |

## シェーダ設計

### 輝度とトーン座標

- `L = dot(c.rgb, vec3(0.299, 0.587, 0.114))` → `L = pow(L, uGamma)`
- トーン座標: `vUv` の x に aspect（`uResolution.x / uResolution.y`）を掛けて
  正方セル化 → `uAngle`（ラジアン）で回転 → `* uScale`。
  `uScale` は「画面高さあたりのセル数」になる。

### 面積階調（dot）

セル内距離 `d = length(fract(p) - 0.5)`。インク被覆率が `1 - L` になるよう
半径を面積階調で決める:

```
r = 0.7071 * sqrt(1.0 - L)
```

- L=0 → r=0.7071（セル対角の半分＝セルを完全に埋める）
- L=1 → r=0（ドットが消える）
- `ink = 1.0 - smoothstep(r - aa, r + aa, d)`

### 多線（line）・クロスハッチ（cross）

- line: `s = abs(fract(p.y) - 0.5)`、太さ `t = 0.5 * (1.0 - L)`、
  `ink = 1.0 - smoothstep(t - aa, t + aa, s)`。L=0 で全埋め・L=1 で消える。
- cross: line を `uAngle` と `uAngle + 75°` の 2 方向で計算して `max`。
  完全直交（90°）よりも 75° ずらしのほうが漫画的な見た目になる。

### AA（アンチエイリアス）

`aa` はセル空間でのピクセルフットプリント `fwidth(p.y)`（＋dot は
`length(vec2(fwidth(p.x), fwidth(p.y))) * 0.5`）を使う。
`fwidth(d)` / `fwidth(s)` は `fract()` の不連続点で微分が跳ねて
セル境界に筋が出るため、連続な `p` の微分で代用する（Issue 記載式からの意図的変更）。
three r170 は WebGL2 のみなので `fwidth` は追加拡張なしで使える。

### auto モード（輝度帯によるトーン選択）

しきい値（TS 定数として export し GLSL 文字列へ埋め込む・単一ソース）:

| 帯域 | トーン |
|---|---|
| L < 0.12 | ベタ（ink=1） |
| 0.12–0.35 | cross |
| 0.35–0.60 | line |
| 0.60–0.88 | dot |
| > 0.88 | 白（ink=0） |

境界で急に切り替わると縞が出るため、各しきい値 ±0.03（`TONE_BAND_FADE`）を
smoothstep でクロスフェードする。重みは

```
t_i = smoothstep(B_i - F, B_i + F, L)   (i = 0..3)
w_solid = 1 - t0
w_cross = t0 * (1 - t1)
w_line  = t1 * (1 - t2)
w_dot   = t2 * (1 - t3)
w_white = t3
```

フェード幅（0.03）が帯域幅（最小 0.23）より十分小さいので、フェード区間は
重ならず重みの総和は常に 1。`ink = w_solid*1 + w_cross*crossInk + w_line*lineInk
+ w_dot*dotInk + w_white*0`。TS 側に同じ計算 `screenToneBandWeights(L)` を置いて
テストする（しきい値定数 `TONE_BANDS` / `TONE_BAND_FADE` を共有）。

### 出力色

- mono: `toneCol = mix(vec3(1), vec3(0), ink)`（白地に黒インク）
- color: `toneCol = mix(vec3(1), c.rgb * 0.7, ink)`（元色を若干濃くしてインクに）
- 仕上げ: `gl_FragColor = mix(元画像, toneCol, uMix)`

### mode 分岐

float uniform `uMode`（0=auto, 1=dot, 2=line, 3=cross）の if 連鎖
（`uMode < 0.5` → auto、`< 1.5` → dot、…）。int uniform 分岐の罠回避
（BlendNode/PixelateNode と同じ流儀）。GLSL は ASCII のみ。

## 純関数（テスト対象）

`ScreenToneNode.ts` から export:

- `SCREEN_TONE_MODES` / `SCREEN_TONE_COLORS`: enum 定義順 = uniform 値
- `screenToneModeToFloat(mode)` / `screenToneColorToFloat(color)`: 不正値は 0（auto / mono）
- `sanitizeScreenToneParams({scale, angle, gamma, mix})`: NaN・範囲外を
  default / clamp（scale 20–400, angle 0–180, gamma 0.2–3, mix 0–1）
- `TONE_BANDS` / `TONE_BAND_FADE`: auto の帯域定数（GLSL へ埋め込み）
- `screenToneBandWeights(L)`: 帯域重み（総和 1・帯域中心で該当トーンが支配的）

## 追従

- `nodes/registry.ts`: effect 系（アルファベット順の並び）で RgbShift と
  TextureTransform の間に登録
- i18n（`i18n-nodes.ts`・ja/en）: `node.ScreenTone.desc` /
  `node.ScreenTone.port.in` / `node.ScreenTone.port.texture` /
  `node.ScreenTone.param.{mode,scale,angle,gamma,color,mix}`
