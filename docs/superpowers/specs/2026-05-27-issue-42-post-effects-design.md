# Issue #42: 万華鏡 / フラクタル増殖 post エフェクトを追加

- 対象 Issue: https://github.com/mishi5/three-art/issues/42
- 作品: pose-particles

## 背景

現状の post 処理は `BlurPipeline` (EffectComposer + 多段 ShaderPass) 1 種類のみ。Issue では万華鏡・フラクタル増殖の追加要望があり、加えてユーザより「今後 post effect バリエーションを増やし、最終的にノードベース VJ システム化していきたい」との方針共有あり。

ここで部品化された PostEffect インターフェースを導入し、blur を含む全 effect を順序入れ替え可能なパイプラインに統合する。

## スコープ

### 含む

- 共通 `PostEffect` インターフェースと `PostPipeline` クラスを新設
- 既存 blur を `BlurEffect` として PostPipeline 配下に移植 (`BlurPipeline` は削除)
- 万華鏡 (`KaleidoscopeEffect`) を新規追加
- フラクタル増殖 (`FractalEffect`、Droste 風再帰縮小コピー) を新規追加
- SettingsPanel で各 effect のパラメータ、および ↑↓ ボタンによる順序入れ替え UI を提供
- localStorage への順序保存・復元
- thumbnail-capture との互換 (本番と同じ順で 256x144 RT 上に pass 列を再構築)
- randomize / param-docs / param-relevance への登録
- AutomationMap (新パラメータの安全なデフォルト値) への追記

### 含まない

- 音響リアクティブ (bass で segments 変化等) — Issue 補足通り後続 issue
- drag-and-drop による順序入れ替え UI — ↑↓ ボタンで十分
- 完全自由なノード接続グラフ (各 effect は直列のみ)
- effect の動的追加・削除 (固定 3 種のみ。将来エフェクト追加時は実装で 1 ファイル足す前提)
- `BlurPipeline` 後方互換 (型エイリアスや旧 API は残さない、移行は本コミット内で完結)

## 設計

### PostEffect インターフェース (`src/pose-particles/visuals/post/PostEffect.ts`)

```ts
import type { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import type { Settings } from "../../settings";
import type { SmoothedAudio } from "../../audio/SmoothedAudio";

/** post パイプラインに直列接続される 1 エフェクト部品。 */
export interface PostEffect {
  /** 一意な ID (settings.post.order に格納されるキー)。例: "blur" | "kaleidoscope" | "fractal" */
  readonly id: string;

  /** 本番 EffectComposer に追加する ShaderPass 列 (例: blur は H/V の 2 本 × iterations)。 */
  readonly passes: ShaderPass[];

  /** 毎フレーム呼ばれる。enabled / パラメータの反映を行う。 */
  update(settings: Settings, audio: SmoothedAudio): void;

  /** リサイズ通知。texel 依存 effect (blur) のみ実体を持つ。 */
  setSize(w: number, h: number, dpr: number): void;

  /**
   * サムネ用に「現在の effect 設定を targetW×targetH 上で再現する独立 pass 列」を返す。
   * blur のように絶対 px 単位のパラメータを持つ effect は scale 補正する。
   * kaleidoscope/fractal のように UV (0..1) のみで完結する effect は単純に新規 pass を作る。
   * 呼び出し側で必ず dispose する。enabled でないなら空配列を返す。
   */
  createPassesForTarget(targetW: number, targetH: number, fullSourceW: number): ShaderPass[];

  dispose(): void;
}
```

### PostPipeline (`src/pose-particles/visuals/post/PostPipeline.ts`)

```ts
export class PostPipeline {
  private composer: EffectComposer;
  private renderPass: RenderPass;
  private outputPass: OutputPass;
  private effects: Map<string, PostEffect>;  // id → effect
  private currentOrder: string[];            // 適用順

  constructor(renderer, scene, camera) {
    this.composer = new EffectComposer(renderer);
    this.renderPass = new RenderPass(scene, camera);
    this.outputPass = new OutputPass();
    this.effects = new Map([
      ["blur", new BlurEffect()],
      ["kaleidoscope", new KaleidoscopeEffect()],
      ["fractal", new FractalEffect()],
    ]);
    this.currentOrder = ["blur", "kaleidoscope", "fractal"];  // 初期順
    this.rebuild();
  }

  /** settings.post.order が currentOrder と異なれば composer を組み直す。 */
  syncOrder(order: string[]): void { /* ... */ }

  setSize(w, h): void;
  update(settings, audio): void;
  render(): void;

  /** thumbnail-capture が呼ぶ。enabled な effect だけを現在の order で並べた pass 列を返す。 */
  createPassesForTarget(targetW, targetH, fullSourceW): ShaderPass[] {
    const out: ShaderPass[] = [];
    for (const id of this.currentOrder) {
      const eff = this.effects.get(id);
      if (!eff) continue;
      out.push(...eff.createPassesForTarget(targetW, targetH, fullSourceW));
    }
    return out;
  }
}
```

`rebuild()` の動作:

1. `composer.passes` を一度クリア (renderPass / outputPass を除く全 pass を removeAll)
2. `renderPass` を addPass
3. `currentOrder` の順で各 effect の `passes` を addPass
4. `outputPass` を addPass

`syncOrder()` は order 配列の等価比較を行い、変化があった場合のみ `rebuild` を呼ぶ。順序入れ替え時のみ composer を組み直すので毎フレームのコストは無視できる。

### settings 拡張 (`src/pose-particles/settings.ts`)

```ts
export interface KaleidoscopeSettings {
  /** post の万華鏡 on/off */
  enabled: boolean;
  /** 扇形セグメント数 (2..16, 整数)。default 6。 */
  segments: number;
  /** 中心 X (-0.5..0.5、画面中央=0)。default 0。 */
  centerX: number;
  /** 中心 Y (-0.5..0.5)。default 0。 */
  centerY: number;
  /** 全体回転 (rad)。default 0。 */
  rotation: number;
  /** 元映像とのブレンド率 (0..1)。1=完全に万華鏡。default 1。 */
  mix: number;
}

export interface FractalSettings {
  /** post の再帰増殖 on/off */
  enabled: boolean;
  /** 再帰回数 (1..6、整数)。default 3。 */
  iterations: number;
  /** 各反復の縮小率 (0.5..0.95)。default 0.7。 */
  scale: number;
  /** 中心 X (-0.5..0.5)。default 0。 */
  centerX: number;
  /** 中心 Y (-0.5..0.5)。default 0。 */
  centerY: number;
  /** 反復ごとの回転 (rad)。default 0。 */
  rotation: number;
  /** 深いコピーほど暗くするフェード (0..1)。0=フェードなし、1=最深層を黒に。default 0.3。 */
  fade: number;
  /** 元映像とのブレンド率 (0..1)。default 1。 */
  mix: number;
}

export interface Settings {
  // ...
  blur: BlurSettings;                     // 既存
  post: {
    /** effect ID の適用順。settings.blur は互換性のため別場所維持、order に "blur" が含まれる */
    order: string[];                      // default ["blur", "kaleidoscope", "fractal"]
    kaleidoscope: KaleidoscopeSettings;
    fractal: FractalSettings;
  };
}
```

`settings.blur` はパス互換のため `settings.post.blur` には移動しない (既存 randomize / AutomationMap / 保存値との互換)。新規 2 つは `settings.post.kaleidoscope` / `settings.post.fractal` に置く。

`migrate()` で旧 settings (`post` が無い) を読み込んだ場合、デフォルトで埋める (既存 deepMerge で吸収される)。

### Kaleidoscope shader

```glsl
uniform sampler2D tDiffuse;
uniform float uSegments;        // 整数だが float 渡し
uniform vec2 uCenter;           // 画面中心オフセット (-0.5..0.5)
uniform float uRotation;
uniform float uMix;
uniform float uAspect;          // w/h
varying vec2 vUv;

void main() {
  // 中心基準、アスペクト補正で円形にする
  vec2 p = vUv - 0.5 - uCenter;
  p.x *= uAspect;
  float r = length(p);
  float theta = atan(p.y, p.x) + uRotation;
  float seg = 6.28318530718 / max(2.0, uSegments);
  // mod でセグメント内角度に折り畳み、半分超えたら鏡像反転
  float t = mod(theta, seg);
  if (t > seg * 0.5) t = seg - t;
  vec2 q = vec2(cos(t), sin(t)) * r;
  q.x /= uAspect;
  q += 0.5 + uCenter;
  vec4 src = texture2D(tDiffuse, vUv);
  vec4 kal = texture2D(tDiffuse, clamp(q, 0.0, 1.0));
  gl_FragColor = mix(src, kal, uMix);
}
```

WebGL1 互換: 動的 `for` なし、整数 `%` なし、float `mod()` のみ使用。`uSegments` は float uniform。`if` 1 個 (角度折り返し) は無条件分岐相当 (一様 uniform で動かない分岐ではないが、フラグメントごとに分岐するため highp/コスト確認は行うが gl_PointSize 等の罠は無し)。

### Fractal shader

```glsl
uniform sampler2D tDiffuse;
uniform float uIterations;      // 1..6 を float で。最大 6 固定 for で回す
uniform float uScale;           // 0.5..0.95
uniform vec2 uCenter;
uniform float uRotation;
uniform float uFade;
uniform float uMix;
varying vec2 vUv;

void main() {
  vec4 acc = vec4(0.0);
  float wsum = 0.0;
  vec2 c = 0.5 + uCenter;
  // 最大 6 段の固定 for (WebGL1 制約) + iterations による break
  for (int i = 0; i < 6; i++) {
    if (float(i) >= uIterations) break;
    float k = pow(uScale, float(i));
    float rot = uRotation * float(i);
    float cs = cos(rot), sn = sin(rot);
    vec2 d = vUv - c;
    vec2 r = vec2(d.x * cs - d.y * sn, d.x * sn + d.y * cs);
    vec2 q = r / k + c;
    // 範囲外はサンプルしない (透明扱い)
    float inside = step(0.0, q.x) * step(q.x, 1.0) * step(0.0, q.y) * step(q.y, 1.0);
    float w = mix(1.0, 1.0 - float(i) / max(1.0, uIterations - 1.0), uFade) * inside;
    acc += texture2D(tDiffuse, q) * w;
    wsum += w;
  }
  vec4 base = texture2D(tDiffuse, vUv);
  vec4 frac = (wsum > 0.0) ? acc / wsum : base;
  gl_FragColor = mix(base, frac, uMix);
}
```

WebGL1 罠回避:

- `for` ループは **コンパイル時に判定できる定数上限 (= 6)**、break 条件のみ uniform 比較
- 配列の動的インデックス参照は使わない
- 整数 modulo は使わない (`float(i)` のみ)
- ASCII 範囲のみ

### App.ts 統合

`BlurPipeline` 関連の参照を `PostPipeline` に置き換え:

- `this.blurPipeline = new BlurPipeline(...)` → `this.postPipeline = new PostPipeline(...)`
- `this.blurPipeline.setSize(w, h)` → `this.postPipeline.setSize(w, h)`
- `this.blurPipeline.update(live.blur, this.smoothedAudio.bass)` → `this.postPipeline.update(live, this.smoothedAudio)`
  - update 内部で order の sync、各 effect への settings/audio 受け渡しを行う
- `this.blurPipeline.render()` → `this.postPipeline.render()`
- `this.blurPipeline.createBlurPassesForTarget(...)` → `this.postPipeline.createPassesForTarget(...)`

サムネ生成側 (`presets/thumbnail-capture.ts` を呼ぶ App.ts:707 付近) はインターフェース名のみ変わる。`thumbnail-capture.ts` 自体は無改修 (`extraPasses` 経由でパス列を受け取る I/F は変えない)。

### SettingsPanel UI (`src/pose-particles/ui/SettingsPanel.ts`)

既存の "Blur (post-process)" フォルダがあった場所を "Post effects" フォルダに改名し、その下に:

- **順序コントロール**: lil-gui の `add` でカスタムボタンを 6 個 (blur ↑/↓、kaleidoscope ↑/↓、fractal ↑/↓) 並べる。または currentOrder を読みつつボタンラベルを動的更新する 1 行表示 (要件: 「↑↓ボタン」)
- **Blur サブフォルダ** (既存): enabled / strength / iterations / bassDrive
- **Kaleidoscope サブフォルダ**: enabled / segments (2..16, 1) / centerX (-0.5..0.5) / centerY (-0.5..0.5) / rotation (-π..π) / mix (0..1)
- **Fractal サブフォルダ**: enabled / iterations (1..6, 1) / scale (0.5..0.95) / centerX / centerY / rotation (-π..π) / fade (0..1) / mix (0..1)

順序ボタン実装案:

```ts
const orderFolder = post.addFolder("Order (top → applied first)");
const renderOrderLabels = () => {
  // settings.post.order の現在値をテキストで表示
};
const moveUp = (id: string) => { /* settings.post.order を入れ替え, save, this.applyActivation() */ };
const moveDown = (id: string) => { /* ... */ };
// 3 effect × ↑↓ で 6 button (effect ごとに 1 行)
```

入れ替え時は `saveSettings(settings)` を呼ぶことで localStorage 反映。次フレームの `postPipeline.update` で `syncOrder` が `rebuild` を呼ぶ。

### randomize 登録 (`src/pose-particles/ui/randomize.ts`)

`randomize.test.ts` の drift 防止テスト (`covers every Settings leaf except explicit exclusions`) により、新規 leaf は全て `RANDOMIZE_DESCRIPTORS` に登録する必要がある (除外できるのは `mode` / `auto.*` / `image.preset` のみ)。post 系は全 mode で効くので modes = `ALL` で登録する。

範囲は SettingsPanel と一致させる:

```ts
// post.kaleidoscope
bool("post.kaleidoscope.enabled", ALL),
num("post.kaleidoscope.segments",  2,   16,  1,    ALL),
num("post.kaleidoscope.centerX",  -0.5, 0.5, 0.01, ALL),
num("post.kaleidoscope.centerY",  -0.5, 0.5, 0.01, ALL),
num("post.kaleidoscope.rotation", -Math.PI, Math.PI, 0.01, ALL),
num("post.kaleidoscope.mix",       0,   1,   0.01, ALL),

// post.fractal
bool("post.fractal.enabled", ALL),
num("post.fractal.iterations", 1, 6, 1, ALL),
num("post.fractal.scale", 0.5, 0.95, 0.01, ALL),
num("post.fractal.centerX", -0.5, 0.5, 0.01, ALL),
num("post.fractal.centerY", -0.5, 0.5, 0.01, ALL),
num("post.fractal.rotation", -Math.PI, Math.PI, 0.01, ALL),
num("post.fractal.fade", 0, 1, 0.01, ALL),
num("post.fractal.mix", 0, 1, 0.01, ALL),
```

`post.order` (string[]) は leaf に分解されない (配列は 1 leaf として `settingsLeafPaths` が止まる) ため、明示除外を考える。

→ **実装時の追加対応**: `post.order` が leaf として残る場合、`randomize.test.ts` の `isExcluded` に `p === "post.order"` を追加する必要がある (post 演出順は ↑↓ ボタンで明示的に編集する性質のもので randomize しない、という意図)。または `settingsLeafPaths` を「配列を leaf として返す」現実装を踏襲し、`numEnum` 等にも該当しないので除外宣言する。

実装ステップで `bun run test` を回しながら最小修正にとどめる。

### param-relevance (`src/pose-particles/ui/param-relevance.ts`)

post 系は blur と同じく ALL mode (全 mode で関連あり)。

```ts
"post.kaleidoscope.enabled": new Set(ALL),
"post.kaleidoscope.segments": new Set(ALL),
// ...
"post.fractal.enabled": new Set(ALL),
// ...
```

### param-docs (`src/pose-particles/ui/param-docs.ts`)

各 leaf に summary / effect を追加。日本語、既存スタイルに合わせる。

### AutomationMap (`src/pose-particles/automation/AutomationMap.ts`)

各 STYLE_PRESETS に `post.kaleidoscope.enabled: false`, `post.fractal.enabled: false` を追記 (デフォルト挙動を変えない安全側)。`post.kaleidoscope.segments` 等の数値は AutomationMap の管轄に入れない (派手なエフェクトを auto で勝手に変えるのは UX 上避けたい、必要なら別 issue)。

## テスト戦略

実装ファイルごとに `*.test.ts` を作る (既存パターン踏襲)。WebGL コンテキスト不要な範囲に絞る。

### 新規テスト

1. **`visuals/post/PostPipeline.test.ts`**
   - 順序入れ替え (`syncOrder(["fractal", "blur", "kaleidoscope"])`) で `composer.passes` の順が変わること
   - 同じ order を 2 回渡しても rebuild が走らない (`composer.addPass` 呼び出し回数で確認)
   - 不正 ID (`["nonexistent"]`) は無視されること

2. **`visuals/post/PostPipeline.createPassesForTarget.test.ts`**
   - 全 effect enabled 時、返却 pass 数 = sum(各 effect の pass 数)
   - kaleidoscope のみ enabled なら 1 pass
   - 並び順が `syncOrder` と一致すること

3. **`visuals/post/KaleidoscopeEffect.test.ts`**
   - settings.post.kaleidoscope.enabled = false で pass.enabled = false
   - segments=6 で uniform `uSegments` が 6 になる
   - centerX/Y / rotation / mix が uniform に正しく伝搬

4. **`visuals/post/FractalEffect.test.ts`**
   - iterations 等の uniform 伝搬
   - enabled / mix 連動

5. **`visuals/post/kaleidoscope-shader.test.ts`**
   - shader 文字列が ASCII のみ (`/^[\x00-\x7F]*$/`)
   - 動的 for / 整数 % / 動的配列インデックスが含まれていない (簡易 lint)

6. **`visuals/post/fractal-shader.test.ts`**
   - shader 文字列が ASCII のみ
   - `for (int i = 0; i < 6; i++)` を含む (固定上限ループであること)

### 既存テストの追従

- `param-docs.test.ts` の「settingsLeafPaths の全 leaf が PARAM_DOCS にある」テスト → 新 leaf を PARAM_DOCS に追加することでパスする
- `randomize.test.ts` の「全 leaf が randomize テーブルにある」テスト → 新 leaf を `RANDOMIZE_FIELDS` に登録
- `param-relevance.test.ts` の「post 系は全 mode で active」確認に新パス追加
- `settings.test.ts` の `makeDefaultSettings` / `loadSettings` テスト → `post` セクションのデフォルト値検証を追加
- `AutomationMap` のスナップショット系テストがあれば追従

### 削除されるテスト

- `BlurPipeline.createBlurPassesForTarget.test.ts` → `BlurEffect.createPassesForTarget.test.ts` にリネーム + 内容移植
- `BlurPipeline` を直接参照しているテストは `PostPipeline` または `BlurEffect` 経由に書き換え

## リスク・トレードオフ

| リスク | 影響 | 対応 |
|---|---|---|
| 順序入れ替え時の composer 再構築コスト | フレームスキップの可能性 | 順序変更は GUI イベントでしか発生しない (毎フレームではない)。`syncOrder` で order 等価比較を入れ、無変化なら rebuild しない |
| BlurPipeline 削除による保存済み settings との非互換 | ユーザの localStorage 影響なし | `settings.blur` のキー名・構造は維持。`post` は deepMerge でデフォルト埋め |
| サムネで万華鏡/フラクタルが動的な順序を反映できないバグ | サムネと本番が乖離 | `PostPipeline.createPassesForTarget` が `currentOrder` を参照することで自動同期、テストでも `syncOrder` 後の順序を検証 |
| WebGL1 で fractal の `for(int)` がドライバ依存で展開失敗 | shader compile エラー | 上限を定数 6 にしてベンダー実装の制約を回避、break 条件は uniform 比較。実機 (Mac/iOS Safari) で動作確認はユーザフェーズで |
| `mix` が 0 でも fractal の重い計算が走る | 性能低下 | 各 effect の `pass.enabled` を `settings.enabled && mix > 0` で early out、shader 内ではコスト最小化は深追いしない |

## ファイル変更マップ

新規:
- `src/pose-particles/visuals/post/PostEffect.ts` (型)
- `src/pose-particles/visuals/post/PostPipeline.ts`
- `src/pose-particles/visuals/post/BlurEffect.ts`
- `src/pose-particles/visuals/post/KaleidoscopeEffect.ts`
- `src/pose-particles/visuals/post/FractalEffect.ts`
- 各 `*.test.ts`

更新:
- `src/pose-particles/settings.ts` (`post` セクション追加、`migrate`)
- `src/pose-particles/App.ts` (BlurPipeline → PostPipeline)
- `src/pose-particles/ui/SettingsPanel.ts` (Post effects フォルダ、順序ボタン)
- `src/pose-particles/ui/randomize.ts` (新 leaf 登録)
- `src/pose-particles/ui/param-docs.ts` (新 leaf doc)
- `src/pose-particles/ui/param-relevance.ts` (新 leaf relevance)
- `src/pose-particles/automation/AutomationMap.ts` (新 leaf default)

削除:
- `src/pose-particles/visuals/BlurPipeline.ts`
- `src/pose-particles/visuals/BlurPipeline.createBlurPassesForTarget.test.ts` (BlurEffect 版にリネーム)

`src/pose-particles/visuals/blur.ts` (`BlurSettings` 型と effectiveBlurStrength) は維持。`BlurEffect` 内部で参照する。

## 実装順 (writing-plans で詳細化)

1. settings.ts に `post` セクション + default + migrate を追加 (テスト先行)
2. PostEffect インターフェース定義
3. BlurEffect 実装 + 既存 BlurPipeline テスト移植
4. PostPipeline 実装 (BlurEffect のみ) + テスト
5. App.ts を PostPipeline に切替、`bun run test` で全件パス確認 (この時点で機能等価)
6. KaleidoscopeEffect 実装 + テスト + PostPipeline 登録
7. FractalEffect 実装 + テスト + PostPipeline 登録
8. SettingsPanel に Post effects フォルダと ↑↓ ボタン
9. randomize / param-docs / param-relevance / AutomationMap 反映
10. 全テスト pass + ブラウザでの目視確認 (ユーザフェーズ)
