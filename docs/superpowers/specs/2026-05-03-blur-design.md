# pose-particles: Blur (post-process Gaussian) — 設計

- 対象 Issue: https://github.com/mishi5/three-art/issues/1
- 対象作品: pose-particles
- ブランチ: `feature/1-blur`
- 日付: 2026-05-03

## 概要

pose-particles のレンダリング結果に、ポストプロセスで分離型 Gaussian
Blur をかける。Three.js の `EffectComposer` を導入し、シーンレンダー →
横ブラー → 縦ブラー（× iterations）→ 出力 のパイプラインを組む。GUI
からは有効/無効・強度・反復回数・bass による強度ドライブを操作する。

ブラーは作品全体に均一にかかり、点群・FragmentField・EdgeOverlay すべて
に同じカーネルが作用する。Twist と同等の存在感を持つ "後処理" 効果として
組み込む。

## 設計

### ファイル構成

追加:

- `src/pose-particles/visuals/blur.ts`
  - 純粋関数 `effectiveBlurStrength(settings.blur, bass)` および
    `applyMotionToBlur(settings.blur, factor)` を提供する。
  - WebGL に依存せずユニットテスト可能にしておく。
- `src/pose-particles/visuals/blur.test.ts`
  - 上記純粋関数の単体テスト（Twist のテストと同形）。
- `src/pose-particles/visuals/BlurPipeline.ts`
  - `EffectComposer` を内部に持つ薄いラッパ。`render()` / `setSize()` /
    `update(blurSettings, audioBass)` を公開する。

修正:

- `src/pose-particles/App.ts`
  - 通常の `renderer.render(scene, camera)` を `BlurPipeline.render()` に
    差し替える。`handleResize` で composer サイズも更新する。`update()`
    の末尾で `BlurPipeline.update(live.blur, gainedAudio.bass)` を呼ぶ。
- `src/pose-particles/settings.ts`
  - `Settings.blur` を追加、デフォルト・MOTION_TARGETS への登録、
    `cloneSettings`（App.ts 内）への blur フィールド追加。
- `src/pose-particles/ui/SettingsPanel.ts`
  - `Blur (post-process)` フォルダを追加。

### Settings 追加

```ts
blur: {
  enabled: boolean;     // default false
  strength: number;     // 0..30 CSS px, default 4
  iterations: number;   // 1..6, default 2
  bassDrive: number;    // 0..3, default 0
}
```

`MOTION_TARGETS` に `"blur.strength"` を追加し、既存 motion ルーティング
パターンに揃える。

### 純粋関数

```ts
export function effectiveBlurStrength(b: BlurSettings, bass: number): number {
  if (!b.enabled) return 0;
  return b.strength * (1 + bass * b.bassDrive);
}

export function applyMotionToBlur(b: BlurSettings, factor: number): void {
  b.strength *= factor;
}
```

`enabled=false` のとき `effectiveBlurStrength` が `0` を返すことで、
`BlurPipeline.update()` 側の分岐が一箇所で済む（強度 0 → ブラーパス
無効化）。

### BlurPipeline

```ts
class BlurPipeline {
  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera);
  setSize(w: number, h: number, pixelRatio: number): void;
  update(b: BlurSettings, bass: number): void;
  render(): void;   // 常に composer.render() を呼ぶ（強度0時はブラーパスを enabled=false にしてバイパス）
}
```

内部:

- `EffectComposer` ＋ `RenderPass(scene, camera)`
- 横用 `ShaderPass`、縦用 `ShaderPass`（同じシェーダ、`uDirection`
  uniform のみ違う）
- `OutputPass`（色空間補正は Three.js デフォルトに任せる）
- 反復は `composer.passes` を毎フレーム再構築するのではなく、
  最大 6 反復ぶんの horizontal/vertical pair をあらかじめ生成し、
  `pass.enabled = i < iterations` でスイッチする。
- `effectiveBlurStrength === 0` のときはブラーパス全体を `enabled = false`
  にし、実質 `RenderPass + OutputPass` のみが走るようにする。
  `render()` は常に `composer.render()` でよい（OutputPass の色変換は
  Three.js のデフォルトと差がないので破綻しない）。

### Blur シェーダ（ASCII のみ）

9-tap separable Gaussian。タップ重みは GLSL 内に固定、半径だけ uniform。

```glsl
uniform sampler2D tDiffuse;
uniform vec2 uTexel;
uniform vec2 uDirection;
uniform float uRadius;
varying vec2 vUv;

void main() {
  vec2 step = uTexel * uDirection * uRadius;
  vec4 c = texture2D(tDiffuse, vUv) * 0.227027;
  c += texture2D(tDiffuse, vUv + step * 1.0) * 0.194595;
  c += texture2D(tDiffuse, vUv - step * 1.0) * 0.194595;
  c += texture2D(tDiffuse, vUv + step * 2.0) * 0.121622;
  c += texture2D(tDiffuse, vUv - step * 2.0) * 0.121622;
  c += texture2D(tDiffuse, vUv + step * 3.0) * 0.054054;
  c += texture2D(tDiffuse, vUv - step * 3.0) * 0.054054;
  c += texture2D(tDiffuse, vUv + step * 4.0) * 0.016216;
  c += texture2D(tDiffuse, vUv - step * 4.0) * 0.016216;
  gl_FragColor = c;
}
```

注意:

- ASCII のみ（GLSL コメント含め日本語・全角を入れない）。
- `uniform int` を使わず、向きは `vec2 uDirection` に格納する。
- シェーダソースは TypeScript テンプレートリテラルとしてインライン化する
  （Bun の `.glsl` text import は不安定）。

### App.ts 統合

- コンストラクタ末尾で `this.blurPipeline = new BlurPipeline(...)`、初期
  `setSize` を呼ぶ。
- `handleResize` 内で `this.blurPipeline.setSize(w, h, this.renderer.getPixelRatio())` を呼ぶ。
- `start()` の tick 内、`this.renderer.render(this.scene, this.camera)`
  を `this.blurPipeline.render()` に置き換える。
- `update()` の末尾で `this.blurPipeline.update(live.blur, this.smoothedAudio.bass)` を呼ぶ。
- `cloneSettings` に `blur: { ...s.blur }` を追加。
- `applyMotionTo` に `case "blur.strength"` を追加。

### GUI

```ts
const blur = this.gui.addFolder("Blur (post-process)");
blur.add(settings.blur, "enabled").name("enabled");
blur.add(settings.blur, "strength", 0, 30, 0.1).name("strength (px)");
blur.add(settings.blur, "iterations", 1, 6, 1).name("iterations");
blur.add(settings.blur, "bassDrive", 0, 3, 0.05).name("bass drive");
```

### テスト計画（TDD）

`visuals/blur.test.ts`:

1. `effectiveBlurStrength`
   - `enabled=false` → 0 を返す（他のパラメータがどうであっても）
   - `enabled=true, bassDrive=0, bass=任意` → strength を返す
   - `enabled=true, strength=4, bassDrive=2, bass=0.5` → 4 * (1 + 0.5*2) = 8
   - `enabled=true, bass=0` → strength を返す
2. `applyMotionToBlur`
   - `factor=2` で strength が 2 倍になる
   - 他のフィールド（enabled / iterations / bassDrive）は変化しない

WebGL レンダリング自体は単体テストせず、ユーザの目視確認に委ねる
（既存 Twist テストと同じ方針）。

### パフォーマンス

- iterations=2（デフォルト）で 4 ブラーパス + RenderPass + OutputPass。
  retina 2× の通常解像度なら問題なく動作する想定（既存の point/fragment
  描画が支配的）。
- RT は `THREE.UnsignedByteType` / `RGBAFormat` / `LinearFilter`。HDR
  していないので半精度浮動小数点は不要。
- リサイズ時は `composer.setSize(w, h)` で内部 RT が再生成される。

### 既存トラップへの対応

threejs-art skill のチェックリストに準拠する:

1. `renderer.setSize(w, h)` の第 3 引数を変更しない（既存どおり）。
2. シェーダソースに非 ASCII 文字を含めない。
3. `.glsl` ファイルを import せず TS インライン文字列で定義。
4. 配列の動的インデックス参照なし。
5. 整数 uniform でモード分岐しない（`vec2 uDirection` で表現）。

## 想定外スコープ（Non-goals）

- HDR / Bloom（Issue #1 の範疇外。別 Issue 化を検討する場合は別途相談する）
- Motion Blur / Radial Blur 等の方向性付きブラー
- ダウンサンプル + Kawase 等のパフォーマンス特化実装（必要になったら別途
  Issue 化）

## 実装順序（writing-plans 側で詳細化）

1. `blur.ts` の純粋関数を実装、`blur.test.ts` で TDD 緑にする
2. `settings.ts` に `Settings.blur` と `MOTION_TARGETS` 追加
3. `BlurPipeline.ts` を実装
4. `App.ts` に統合、`cloneSettings` / `applyMotionTo` を更新
5. `SettingsPanel.ts` に Blur フォルダ追加
6. `bun test` 全件パス確認
7. ユーザによる動作確認
