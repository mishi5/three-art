# Blur ポストプロセス エフェクトの実装

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** pose-particles のレンダリング結果に分離型 Gaussian Blur を後処理でかけ、GUI から live で操作できるようにする。

**Architecture:** Three.js の `EffectComposer` を導入し、`RenderPass(scene, camera)` → `BlurPass(horizontal)` × `BlurPass(vertical)` × iterations → `OutputPass` のパイプラインを構築。9-tap separable Gaussian シェーダを TypeScript インラインで定義し、強度 0 のときはブラーパスを `enabled=false` にしてバイパスする。

**Tech Stack:** Three.js (postprocessing examples), TypeScript, Bun (test runner), lil-gui

対象 Issue: https://github.com/mishi5/three-art/issues/1
対象作品: pose-particles
ブランチ: `feature/1-blur`

---

## ファイル構成

新規:
- `src/pose-particles/visuals/blur.ts` — 純粋関数 (`effectiveBlurStrength`, `applyMotionToBlur`, `makeDefaultBlur`, `BlurSettings` 型)
- `src/pose-particles/visuals/blur.test.ts` — `bun test` 用ユニットテスト
- `src/pose-particles/visuals/BlurPipeline.ts` — `EffectComposer` ラッパ

修正:
- `src/pose-particles/settings.ts` — `Settings.blur`, defaults, `MOTION_TARGETS` への `"blur.strength"` 追加
- `src/pose-particles/App.ts` — BlurPipeline 統合 (render 差し替え, resize, update, cloneSettings, applyMotionTo)
- `src/pose-particles/ui/SettingsPanel.ts` — Blur フォルダ追加

---

## Task 1: blur.ts の純粋関数を TDD で実装

**Files:**
- Create: `src/pose-particles/visuals/blur.test.ts`
- Create: `src/pose-particles/visuals/blur.ts`

- [ ] **Step 1: テストファイルを作成**

`src/pose-particles/visuals/blur.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import {
  applyMotionToBlur,
  effectiveBlurStrength,
  makeDefaultBlur,
  type BlurSettings,
} from "./blur";

const defaultBlur: BlurSettings = {
  enabled: true,
  strength: 4.0,
  iterations: 2,
  bassDrive: 0.0,
};

describe("makeDefaultBlur", () => {
  test("disabled by default with sensible numeric defaults", () => {
    const b = makeDefaultBlur();
    expect(b.enabled).toBe(false);
    expect(b.strength).toBeGreaterThan(0);
    expect(b.iterations).toBeGreaterThanOrEqual(1);
    expect(b.bassDrive).toBe(0);
  });
});

describe("effectiveBlurStrength", () => {
  test("enabled=false yields 0 even with bass and drive", () => {
    const off: BlurSettings = { ...defaultBlur, enabled: false, strength: 10, bassDrive: 2 };
    expect(effectiveBlurStrength(off, 0.5)).toBe(0);
  });

  test("no bassDrive returns plain strength", () => {
    const b: BlurSettings = { ...defaultBlur, strength: 3.0, bassDrive: 0 };
    expect(effectiveBlurStrength(b, 0.9)).toBe(3.0);
  });

  test("bassDrive boosts strength multiplicatively", () => {
    const b: BlurSettings = { ...defaultBlur, strength: 4.0, bassDrive: 2.0 };
    // 4.0 * (1 + 0.5 * 2.0) = 8.0
    expect(effectiveBlurStrength(b, 0.5)).toBeCloseTo(8.0, 6);
  });

  test("zero bass returns plain strength regardless of drive", () => {
    const b: BlurSettings = { ...defaultBlur, strength: 5.0, bassDrive: 3.0 };
    expect(effectiveBlurStrength(b, 0)).toBe(5.0);
  });
});

describe("applyMotionToBlur", () => {
  test("multiplies strength by factor, leaves other fields", () => {
    const b: BlurSettings = { ...defaultBlur, strength: 2.0, iterations: 3, bassDrive: 1.0, enabled: true };
    applyMotionToBlur(b, 1.5);
    expect(b.strength).toBeCloseTo(3.0, 6);
    expect(b.iterations).toBe(3);
    expect(b.bassDrive).toBe(1.0);
    expect(b.enabled).toBe(true);
  });
});
```

- [ ] **Step 2: テスト失敗を確認**

```bash
cd /Users/shun/dev/three-art/.worktrees/1-blur
bun test src/pose-particles/visuals/blur.test.ts
```

期待: `Cannot find module './blur'` で失敗。

- [ ] **Step 3: blur.ts を実装**

`src/pose-particles/visuals/blur.ts`:

```ts
export interface BlurSettings {
  enabled: boolean;
  strength: number;
  iterations: number;
  bassDrive: number;
}

export const MAX_BLUR_ITERATIONS = 6;

export function makeDefaultBlur(): BlurSettings {
  return {
    enabled: false,
    strength: 4.0,
    iterations: 2,
    bassDrive: 0.0,
  };
}

export function effectiveBlurStrength(b: BlurSettings, bass: number): number {
  if (!b.enabled) return 0;
  return b.strength * (1 + bass * b.bassDrive);
}

export function applyMotionToBlur(b: BlurSettings, factor: number): void {
  b.strength *= factor;
}
```

- [ ] **Step 4: テスト緑を確認**

```bash
bun test src/pose-particles/visuals/blur.test.ts
```

期待: PASS（`makeDefaultBlur` 1件 + `effectiveBlurStrength` 4件 + `applyMotionToBlur` 1件 = 計6件）。

- [ ] **Step 5: 全件テストでリグレッションを確認**

```bash
bun test
```

期待: 既存23件 + 新規6件 = 29件 全PASS。

- [ ] **Step 6: コミット**

```bash
git add src/pose-particles/visuals/blur.ts src/pose-particles/visuals/blur.test.ts
git commit -m "$(cat <<'EOF'
#1 feat: blur 純粋関数 (effectiveBlurStrength / applyMotionToBlur)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: settings.ts に blur フィールドを追加

**Files:**
- Modify: `src/pose-particles/settings.ts`

- [ ] **Step 1: import を追加**

`src/pose-particles/settings.ts:7` の twist import の下に:

```ts
import { makeDefaultBlur, type BlurSettings } from "./visuals/blur";
```

- [ ] **Step 2: `MOTION_TARGETS` の末尾要素 `"twist.strength"` の後に新規ターゲットを追加**

`src/pose-particles/settings.ts` の MOTION_TARGETS 配列の `"twist.strength",` の次の行に追加:

```ts
  "blur.strength",
```

- [ ] **Step 3: `Settings` インターフェースに `blur` フィールドを追加**

`Settings` の `twist: TwistSettings;` の次の行に追加:

```ts
  /** ポストプロセス Gaussian Blur 設定 */
  blur: BlurSettings;
```

- [ ] **Step 4: `makeDefaultSettings()` に `blur` を追加**

`makeDefaultSettings()` の return オブジェクト内、`twist: makeDefaultTwist(),` の次の行に追加:

```ts
    blur: makeDefaultBlur(),
```

- [ ] **Step 5: 型エラーがないことを確認**

```bash
bun test
```

期待: 全件 PASS。Settings の load/save は deep-merge があるため既存スナップショットでも問題なし。

- [ ] **Step 6: コミット**

```bash
git add src/pose-particles/settings.ts
git commit -m "$(cat <<'EOF'
#1 feat: Settings.blur と blur.strength を MOTION_TARGETS に追加

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: BlurPipeline.ts を実装

**Files:**
- Create: `src/pose-particles/visuals/BlurPipeline.ts`

- [ ] **Step 1: BlurPipeline を作成**

`src/pose-particles/visuals/BlurPipeline.ts`:

```ts
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { type BlurSettings, MAX_BLUR_ITERATIONS, effectiveBlurStrength } from "./blur";

// 9-tap separable Gaussian. ASCII only (WebGL1 GLSL ES 1.00 portability).
// uDirection is (1,0) for horizontal pass, (0,1) for vertical.
// uTexel = 1.0 / RT size in pixels. Sample step = uTexel * uDirection * uRadius.
const blurFragment = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform vec2 uTexel;
  uniform vec2 uDirection;
  uniform float uRadius;
  varying vec2 vUv;

  void main() {
    vec2 stepv = uTexel * uDirection * uRadius;
    vec4 c = texture2D(tDiffuse, vUv) * 0.227027;
    c += texture2D(tDiffuse, vUv + stepv * 1.0) * 0.194595;
    c += texture2D(tDiffuse, vUv - stepv * 1.0) * 0.194595;
    c += texture2D(tDiffuse, vUv + stepv * 2.0) * 0.121622;
    c += texture2D(tDiffuse, vUv - stepv * 2.0) * 0.121622;
    c += texture2D(tDiffuse, vUv + stepv * 3.0) * 0.054054;
    c += texture2D(tDiffuse, vUv - stepv * 3.0) * 0.054054;
    c += texture2D(tDiffuse, vUv + stepv * 4.0) * 0.016216;
    c += texture2D(tDiffuse, vUv - stepv * 4.0) * 0.016216;
    gl_FragColor = c;
  }
`;

const blurVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

interface BlurPair {
  horizontal: ShaderPass;
  vertical: ShaderPass;
}

export class BlurPipeline {
  private composer: EffectComposer;
  private blurPairs: BlurPair[] = [];
  private texelW = 1;
  private texelH = 1;

  constructor(
    private renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
  ) {
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));

    for (let i = 0; i < MAX_BLUR_ITERATIONS; i++) {
      const horizontal = this.makeBlurPass(1, 0);
      const vertical = this.makeBlurPass(0, 1);
      horizontal.enabled = false;
      vertical.enabled = false;
      this.composer.addPass(horizontal);
      this.composer.addPass(vertical);
      this.blurPairs.push({ horizontal, vertical });
    }

    this.composer.addPass(new OutputPass());
  }

  private makeBlurPass(dx: number, dy: number): ShaderPass {
    return new ShaderPass({
      uniforms: {
        tDiffuse: { value: null },
        uTexel: { value: new THREE.Vector2(1, 1) },
        uDirection: { value: new THREE.Vector2(dx, dy) },
        uRadius: { value: 1.0 },
      },
      vertexShader: blurVertex,
      fragmentShader: blurFragment,
    });
  }

  setSize(w: number, h: number): void {
    this.composer.setSize(w, h);
    // EffectComposer's RT is sized by setSize but already accounts for pixelRatio
    // via the renderer's drawing buffer. Texel = 1 / drawing buffer dimensions.
    const dpr = this.renderer.getPixelRatio();
    this.texelW = 1.0 / Math.max(1, Math.floor(w * dpr));
    this.texelH = 1.0 / Math.max(1, Math.floor(h * dpr));
    this.refreshTexelUniforms();
  }

  private refreshTexelUniforms(): void {
    for (const pair of this.blurPairs) {
      (pair.horizontal.uniforms.uTexel.value as THREE.Vector2).set(this.texelW, this.texelH);
      (pair.vertical.uniforms.uTexel.value as THREE.Vector2).set(this.texelW, this.texelH);
    }
  }

  update(b: BlurSettings, bass: number): void {
    const radius = effectiveBlurStrength(b, bass);
    const active = radius > 0;
    const iterations = Math.max(1, Math.min(MAX_BLUR_ITERATIONS, Math.round(b.iterations)));
    for (let i = 0; i < this.blurPairs.length; i++) {
      const pair = this.blurPairs[i]!;
      const enabled = active && i < iterations;
      pair.horizontal.enabled = enabled;
      pair.vertical.enabled = enabled;
      pair.horizontal.uniforms.uRadius.value = radius;
      pair.vertical.uniforms.uRadius.value = radius;
    }
  }

  render(): void {
    this.composer.render();
  }
}
```

- [ ] **Step 2: 型チェックとテスト**

```bash
bun test
```

期待: 全件PASS（BlurPipeline 自体はまだどこからも import されていないが、tsconfig strict + noUncheckedIndexedAccess で型エラーが出ないことを確認）。Bun のテスト実行は import される範囲のみコンパイルするので、import されていないファイルは検査されない可能性がある。明示的に確認:

```bash
bun build src/pose-particles/visuals/BlurPipeline.ts --target browser --outdir /tmp/blur-build-check
```

期待: コンパイル成功、エラーなし（ただし three の import 解決ができない場合は無視可。次タスクで App.ts に組み込んだ後にまとめて確認できれば十分）。

- [ ] **Step 3: コミット**

```bash
git add src/pose-particles/visuals/BlurPipeline.ts
git commit -m "$(cat <<'EOF'
#1 feat: BlurPipeline (EffectComposer + 9-tap separable Gaussian)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: App.ts に BlurPipeline を統合

**Files:**
- Modify: `src/pose-particles/App.ts`

- [ ] **Step 1: import を追加**

`src/pose-particles/App.ts:10` の EdgeOverlay import の次の行に追加:

```ts
import { BlurPipeline } from "./visuals/BlurPipeline";
```

- [ ] **Step 2: フィールド追加**

`App` クラスのフィールド領域、`readonly edgeOverlay: EdgeOverlay;` の次あたりに追加:

```ts
  readonly blurPipeline: BlurPipeline;
```

- [ ] **Step 3: コンストラクタで初期化（handleResize より前）**

`App.ts` のコンストラクタ内、`this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));` の直後、`this.handleResize();` の直前に追加:

```ts
    this.blurPipeline = new BlurPipeline(this.renderer, this.scene, this.camera);
```

理由: `handleResize()` が直後に呼ばれて `BlurPipeline.setSize` を叩くため、その時点で `blurPipeline` は確実に存在している必要がある。順序を整えれば `readonly` のまま optional チェーン不要にできる。

- [ ] **Step 4: handleResize に composer サイズ更新を追加**

`App.ts` の `handleResize` メソッド内、`this.camera.updateProjectionMatrix();` の直後に追加:

```ts
    this.blurPipeline.setSize(w, h);
```

- [ ] **Step 5: render 呼び出しを差し替え**

`App.ts` の `start()` 内 tick 関数:

```ts
      this.renderer.render(this.scene, this.camera);
```

を:

```ts
      this.blurPipeline.render();
```

に置き換える。

- [ ] **Step 6: update() の末尾で BlurPipeline を更新**

`App.ts` の `update()` の最後（`this.centroidMarker.position.set(...)` の直前あたり）に追加:

```ts
    this.blurPipeline.update(live.blur, this.smoothedAudio.bass);
```

- [ ] **Step 7: cloneSettings に blur を追加**

`App.ts` の `cloneSettings` 関数内、`twist: { ...s.twist },` の次の行に追加:

```ts
    blur: { ...s.blur },
```

- [ ] **Step 8: applyMotionTo に blur.strength ケースを追加**

`App.ts` の `applyMotionTo` 関数の switch 文内、`case "twist.strength":` の次の行に追加:

```ts
    case "blur.strength":                s.blur.strength *= factor; break;
```

- [ ] **Step 9: テスト**

```bash
bun test
```

期待: 全件PASS（App.ts は webgl 依存で単体テスト対象外だが、TS コンパイルに通ることを確認）。

- [ ] **Step 10: コミット**

```bash
git add src/pose-particles/App.ts
git commit -m "$(cat <<'EOF'
#1 feat: App に BlurPipeline を統合

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: SettingsPanel に Blur フォルダを追加

**Files:**
- Modify: `src/pose-particles/ui/SettingsPanel.ts`

- [ ] **Step 1: Twist フォルダの直後に Blur フォルダを追加**

`src/pose-particles/ui/SettingsPanel.ts` 内、`twist.add(settings.twist, "phaseSpeed", -3, 3, 0.05).name("phase speed (rad/s)");` の次の行（空行を挟んでよい）に追加:

```ts
    const blur = this.gui.addFolder("Blur (post-process)");
    blur.add(settings.blur, "enabled").name("enabled");
    blur.add(settings.blur, "strength", 0, 30, 0.1).name("strength (px)");
    blur.add(settings.blur, "iterations", 1, 6, 1).name("iterations");
    blur.add(settings.blur, "bassDrive", 0, 3, 0.05).name("bass drive");
```

- [ ] **Step 2: テスト**

```bash
bun test
```

期待: 全件PASS。

- [ ] **Step 3: コミット**

```bash
git add src/pose-particles/ui/SettingsPanel.ts
git commit -m "$(cat <<'EOF'
#1 feat: SettingsPanel に Blur フォルダを追加

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: 動作確認とユーザレビュー

**Files:** （変更なし）

- [ ] **Step 1: 開発サーバを起動して目視確認**

```bash
cd /Users/shun/dev/three-art/.worktrees/1-blur
bun ./pose-particles.html
```

ブラウザで開いて確認する項目:

- 初期状態（`blur.enabled=false`）で、main と見え方が同じであること（ブラーなし）
- GUI の `Blur (post-process)` フォルダで `enabled` を ON にし、`strength` を上げると画面全体がぼけること
- `iterations` を増やすとよりソフトに、減らすとシャープに変化すること
- `bassDrive` を 0 → 3 に上げ、音声入力（マイクや音楽）を流すと bass の山に合わせてブラーが強弱すること
- ウィンドウリサイズ後もブラーが正しい解像度でかかること（粗く見えない）
- `Motion influence` の target を `blur.strength` に切り替え、体が大きく動くとブラー強度がブーストされること
- localStorage 永続化: GUI 値変更 → リロードで値が復元されること

- [ ] **Step 2: ユーザに動作確認を依頼**

期待ステータス: 「OK」「問題なし」など承認応答を得る。問題があれば修正してから次へ。

---

## Task 7: PR を作成

**Files:** （変更なし）

- [ ] **Step 1: ブランチをリモートにプッシュ**

```bash
cd /Users/shun/dev/three-art/.worktrees/1-blur
git push -u origin feature/1-blur
```

- [ ] **Step 2: gh で PR 作成**

```bash
gh pr create --title "#1 feat: Blur ポストプロセスを実装" --body "$(cat <<'EOF'
## Summary
- ポストプロセス Gaussian Blur (separable 9-tap × N iterations) を導入
- `Settings.blur = { enabled, strength, iterations, bassDrive }` を追加し、GUI から live 操作可能
- `MOTION_TARGETS` に `blur.strength` を追加（既存 motion ルーティングと統合）
- 強度 0 のときはブラーパスを無効化してパススルーする

## Test plan
- [ ] `bun test` 全件 PASS（既存23件 + 新規 blur テスト6件）
- [ ] 初期状態（`blur.enabled=false`）で見え方が変わらない
- [ ] `enabled=true / strength` を上げると画面全体がぼける
- [ ] `iterations` 1..6 を切替えてソフトさが変化する
- [ ] `bassDrive` で bass に応じてブラーが強弱する
- [ ] ウィンドウリサイズ後も解像度が破綻しない
- [ ] `motion.target=blur.strength` で動きに応じてブースト
EOF
)"
```

- [ ] **Step 3: PR URL をユーザに通知**

`gh pr create` が出力した URL をそのまま伝える。

- [ ] **Step 4: ユーザのマージ承認を待つ**

ユーザが「マージOK」など承認応答をするまで待機。

---

## Task 8: マージ後のクリーンアップ

**Files:** （変更なし）

- [ ] **Step 1: PR がマージされたことを確認**

```bash
gh pr view feature/1-blur --json state,mergedAt
```

`state` が `MERGED` であること。

- [ ] **Step 2: Issue にクローズコメントを投稿**

```bash
gh issue comment 1 --repo mishi5/three-art --body "$(cat <<'EOF'
## 対応内容
- `src/pose-particles/visuals/blur.ts`: 純粋関数 `effectiveBlurStrength` / `applyMotionToBlur` / `makeDefaultBlur`
- `src/pose-particles/visuals/blur.test.ts`: 関連テスト6件追加
- `src/pose-particles/visuals/BlurPipeline.ts`: EffectComposer ベースの separable Gaussian パイプライン
- `src/pose-particles/settings.ts`: `Settings.blur` と `blur.strength` を `MOTION_TARGETS` に追加
- `src/pose-particles/App.ts`: BlurPipeline 統合 (render 差し替え, resize, update, cloneSettings, applyMotionTo)
- `src/pose-particles/ui/SettingsPanel.ts`: `Blur (post-process)` フォルダ追加

PR: <PR URL>
EOF
)"
```

`<PR URL>` は実際の URL に差し替える。

- [ ] **Step 3: Issue をクローズ**

```bash
gh issue close 1 --repo mishi5/three-art
```

- [ ] **Step 4: worktree とブランチを削除**

```bash
cd /Users/shun/dev/three-art
git worktree remove .worktrees/1-blur
git branch -d feature/1-blur
```

- [ ] **Step 5: main を pull**

```bash
cd /Users/shun/dev/three-art
git pull origin main
```
