# Issue #42: 万華鏡 / フラクタル増殖 post エフェクト 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** post 処理を部品化 (`PostEffect` インターフェース + `PostPipeline`) し、既存 blur に加えて kaleidoscope / fractal を導入。SettingsPanel の ↑↓ ボタンで適用順を入れ替え可能にする。

**Spec:** `docs/superpowers/specs/2026-05-27-issue-42-post-effects-design.md`

**対象 Issue:** https://github.com/mishi5/three-art/issues/42

**Architecture:** `PostEffect` インターフェース (`passes`, `update`, `setSize`, `createPassesForTarget`, `dispose`) で個別 effect を抽象化し、`PostPipeline` が `Map<id, PostEffect>` と `currentOrder: string[]` を保持。`syncOrder()` で composer を必要時のみ rebuild。`BlurPipeline` は廃止し `BlurEffect` に書き直し。新規 `KaleidoscopeEffect`, `FractalEffect` を追加。サムネは `PostPipeline.createPassesForTarget` が現在の順序に従い全 effect 分の pass を作って返す。

**Tech Stack:** TypeScript, Three.js (WebGL1 互換), three/examples/jsm/postprocessing/{EffectComposer, ShaderPass, RenderPass, OutputPass}, Bun test runner (`bun run test` = `bun test --isolate`).

**作業 worktree:** `/Users/shun/dev/three-art/.worktrees/42-post-effects`
**ブランチ:** `feature/42-post-effects`

---

## File Structure

### 新規ファイル

- `src/pose-particles/visuals/post/PostEffect.ts` — インターフェース定義 (型のみ、コード無し)
- `src/pose-particles/visuals/post/PostPipeline.ts` — composer 管理・順序管理
- `src/pose-particles/visuals/post/PostPipeline.test.ts` — 順序入れ替えと createPassesForTarget のテスト
- `src/pose-particles/visuals/post/BlurEffect.ts` — 旧 BlurPipeline の中身を PostEffect に
- `src/pose-particles/visuals/post/BlurEffect.test.ts` — BlurPipeline.createBlurPassesForTarget.test.ts の内容を移植
- `src/pose-particles/visuals/post/KaleidoscopeEffect.ts`
- `src/pose-particles/visuals/post/KaleidoscopeEffect.test.ts`
- `src/pose-particles/visuals/post/FractalEffect.ts`
- `src/pose-particles/visuals/post/FractalEffect.test.ts`

### 変更ファイル

- `src/pose-particles/settings.ts` — `KaleidoscopeSettings` / `FractalSettings` 型と `post` セクションを追加
- `src/pose-particles/settings.test.ts` — `post` セクション default のテスト追加
- `src/pose-particles/App.ts` — `BlurPipeline` → `PostPipeline` 移行
- `src/pose-particles/ui/SettingsPanel.ts` — `Blur (post-process)` フォルダを `Post effects` に置換し、↑↓ ボタン + kaleidoscope / fractal サブフォルダを追加
- `src/pose-particles/ui/param-relevance.ts` — `post.*` の relevance エントリ追加
- `src/pose-particles/ui/param-docs.ts` — `post.*` の docs 追加
- `src/pose-particles/ui/randomize.ts` — `post.*` descriptor 追加
- `src/pose-particles/ui/randomize.test.ts` — `isExcluded` に `post.order` を追加 (string[] leaf は randomize 対象外)

### 削除ファイル

- `src/pose-particles/visuals/BlurPipeline.ts`
- `src/pose-particles/visuals/BlurPipeline.createBlurPassesForTarget.test.ts`

### 既存ファイル責務維持

- `src/pose-particles/visuals/blur.ts` (`BlurSettings`, `effectiveBlurStrength`) は `BlurEffect` 内部で参照するためそのまま残す
- `src/pose-particles/presets/thumbnail-capture.ts` は API 互換 (extraPasses で受ける) のため無改修

---

## Task 1: settings.ts に post セクションを追加 (TDD)

**Files:**
- Modify: `src/pose-particles/settings.ts`
- Test: `src/pose-particles/settings.test.ts`

- [ ] **Step 1: 既存テストを確認**

Run: `cd /Users/shun/dev/three-art/.worktrees/42-post-effects && bun run test src/pose-particles/settings.test.ts 2>&1 | tail -10`

Expected: 既存テストが全件 pass

- [ ] **Step 2: 失敗するテストを書く** — `src/pose-particles/settings.test.ts` の末尾に追加:

```ts
describe("PostEffect settings (Issue #42)", () => {
  test("post.order is [blur, kaleidoscope, fractal] by default", () => {
    const s = makeDefaultSettings();
    expect(s.post.order).toEqual(["blur", "kaleidoscope", "fractal"]);
  });

  test("post.kaleidoscope defaults are sensible and disabled", () => {
    const s = makeDefaultSettings();
    expect(s.post.kaleidoscope.enabled).toBe(false);
    expect(s.post.kaleidoscope.segments).toBe(6);
    expect(s.post.kaleidoscope.centerX).toBe(0);
    expect(s.post.kaleidoscope.centerY).toBe(0);
    expect(s.post.kaleidoscope.rotation).toBe(0);
    expect(s.post.kaleidoscope.mix).toBe(1);
  });

  test("post.fractal defaults are sensible and disabled", () => {
    const s = makeDefaultSettings();
    expect(s.post.fractal.enabled).toBe(false);
    expect(s.post.fractal.iterations).toBe(3);
    expect(s.post.fractal.scale).toBe(0.7);
    expect(s.post.fractal.centerX).toBe(0);
    expect(s.post.fractal.centerY).toBe(0);
    expect(s.post.fractal.rotation).toBe(0);
    expect(s.post.fractal.fade).toBe(0.3);
    expect(s.post.fractal.mix).toBe(1);
  });
});
```

- [ ] **Step 3: テストが失敗することを確認**

Run: `cd /Users/shun/dev/three-art/.worktrees/42-post-effects && bun run test src/pose-particles/settings.test.ts 2>&1 | tail -10`

Expected: `s.post.order` が undefined で fail

- [ ] **Step 4: settings.ts に型定義とデフォルト追加** — `src/pose-particles/settings.ts` の `RainSettings` の下 (line 145 付近) に追加:

```ts
export interface KaleidoscopeSettings {
  enabled: boolean;
  /** 扇形セグメント数 (2..16, 整数)。 */
  segments: number;
  /** 中心 X (-0.5..0.5、画面中央=0)。 */
  centerX: number;
  /** 中心 Y (-0.5..0.5)。 */
  centerY: number;
  /** 全体回転 (rad)。 */
  rotation: number;
  /** 元映像とのブレンド率 (0..1)、1=完全に万華鏡。 */
  mix: number;
}

export interface FractalSettings {
  enabled: boolean;
  /** 再帰回数 (1..6、整数)。 */
  iterations: number;
  /** 各反復の縮小率 (0.5..0.95)。 */
  scale: number;
  centerX: number;
  centerY: number;
  /** 反復ごとの回転 (rad)。 */
  rotation: number;
  /** 深いコピーほど暗くするフェード (0..1)。 */
  fade: number;
  /** 元映像とのブレンド率 (0..1)。 */
  mix: number;
}

export interface PostSettings {
  /**
   * post effect の適用順。effect ID の配列 ["blur", "kaleidoscope", "fractal"]。
   * SettingsPanel の ↑↓ ボタンで入れ替え可能。先頭ほど先に適用される。
   */
  order: string[];
  kaleidoscope: KaleidoscopeSettings;
  fractal: FractalSettings;
}
```

そして `Settings` インターフェースに `post: PostSettings;` を追加:

```ts
  /** Post-process Gaussian blur applied to the final rendered image. */
  blur: BlurSettings;
  /** 部品化された post effects (Issue #42)。順序付き直列適用。 */
  post: PostSettings;
```

`makeDefaultSettings` の末尾 (`audioSmoothing: 0.5,` の前) に追加:

```ts
    post: {
      order: ["blur", "kaleidoscope", "fractal"],
      kaleidoscope: {
        enabled: false,
        segments: 6,
        centerX: 0,
        centerY: 0,
        rotation: 0,
        mix: 1,
      },
      fractal: {
        enabled: false,
        iterations: 3,
        scale: 0.7,
        centerX: 0,
        centerY: 0,
        rotation: 0,
        fade: 0.3,
        mix: 1,
      },
    },
```

- [ ] **Step 5: テストが pass することを確認**

Run: `cd /Users/shun/dev/three-art/.worktrees/42-post-effects && bun run test src/pose-particles/settings.test.ts 2>&1 | tail -10`

Expected: 全件 pass

- [ ] **Step 6: コミット**

```bash
git add src/pose-particles/settings.ts src/pose-particles/settings.test.ts
git commit -m "$(cat <<'EOF'
#42 feat: settings に post セクション (kaleidoscope/fractal) を追加

PostPipeline で参照する order 配列 + kaleidoscope/fractal の各パラメータと
default 値。default はすべて enabled=false なので機能挙動は不変。

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: PostEffect インターフェースを定義 (型のみ)

**Files:**
- Create: `src/pose-particles/visuals/post/PostEffect.ts`

- [ ] **Step 1: ディレクトリ作成と型定義** — `src/pose-particles/visuals/post/PostEffect.ts`:

```ts
import type { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import type { Settings } from "../../settings";

/** SmoothedAudio: 全 effect 共通の音声特徴量 (App.ts の private 型と一致)。 */
export interface SmoothedAudio {
  volume: number;
  bass: number;
  mid: number;
  treble: number;
}

/**
 * post パイプラインに直列接続される 1 エフェクト部品。
 *
 * 設計方針: 各 effect は自分の ShaderPass を所有し、毎フレーム settings/audio から
 * uniform を更新する。サムネ用に「同じ設定で targetW×targetH の RT 上で動く独立
 * pass 列」を返せる契約を持つ。これにより PostPipeline 全体に対しても同じ契約が
 * 自然に派生する (各 effect の createPassesForTarget を集めて返すだけ)。
 */
export interface PostEffect {
  /** 一意な ID (settings.post.order の要素と一致)。 */
  readonly id: string;

  /** 本番 EffectComposer に追加する ShaderPass 列。 */
  readonly passes: ShaderPass[];

  /** 毎フレーム呼ばれる。enabled / パラメータ → uniform 反映。 */
  update(settings: Settings, audio: SmoothedAudio): void;

  /** リサイズ通知。texel 依存 effect (blur) と aspect 依存 effect (kaleidoscope) が利用。 */
  setSize(w: number, h: number, dpr: number): void;

  /**
   * サムネ用に「現在の設定を targetW×targetH の RT 上で再現する独立 pass 列」を返す。
   * - blur: absolute px パラメータを fullSourceW/targetW でスケール補正
   * - kaleidoscope/fractal: UV (0..1) のみで完結するため fullSourceW は不要 (ただし interface は揃える)
   * enabled でない / 効果が無い (mix=0 等) なら空配列。
   * 呼び出し側で dispose 必須。
   */
  createPassesForTarget(targetW: number, targetH: number, fullSourceW: number): ShaderPass[];

  dispose(): void;
}
```

- [ ] **Step 2: TypeScript コンパイル確認**

Run: `cd /Users/shun/dev/three-art/.worktrees/42-post-effects && bunx tsc --noEmit 2>&1 | tail -10`

Expected: 既存型エラーが無ければ "0 errors" 相当 (旧 BlurPipeline 系のエラーは出ない、新規ファイルが import 元未参照でも tsc は通る)

- [ ] **Step 3: コミット**

```bash
git add src/pose-particles/visuals/post/PostEffect.ts
git commit -m "$(cat <<'EOF'
#42 feat: PostEffect インターフェース定義

各 post effect が共通で持つ契約 (passes / update / setSize /
createPassesForTarget / dispose)。SmoothedAudio 型も同居。

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: BlurEffect を実装し既存 BlurPipeline テストを移植 (TDD)

**Files:**
- Create: `src/pose-particles/visuals/post/BlurEffect.ts`
- Create: `src/pose-particles/visuals/post/BlurEffect.test.ts`

- [ ] **Step 1: 失敗するテストを書く** — 旧 `BlurPipeline.createBlurPassesForTarget.test.ts` の構造を踏襲して `src/pose-particles/visuals/post/BlurEffect.test.ts`:

```ts
import { describe, it, expect, beforeAll } from "bun:test";
import * as THREE from "three";
import { BlurEffect } from "./BlurEffect";
import { makeDefaultSettings } from "../../settings";
import { MAX_BLUR_ITERATIONS } from "../blur";

beforeAll(() => {
  // BlurEffect は ShaderPass を内部で作るが、ここでは renderer は不要。
  // happy-dom 由来の WebGL が無くても uniform の値検証だけはできる。
});

function makeAudio(bass = 0) {
  return { volume: 0, bass, mid: 0, treble: 0 };
}

describe("BlurEffect", () => {
  it("id is 'blur'", () => {
    const e = new BlurEffect();
    expect(e.id).toBe("blur");
    e.dispose();
  });

  it("creates MAX_BLUR_ITERATIONS pairs of passes (H + V) = 2 * MAX", () => {
    const e = new BlurEffect();
    expect(e.passes.length).toBe(MAX_BLUR_ITERATIONS * 2);
    e.dispose();
  });

  it("all passes are disabled initially", () => {
    const e = new BlurEffect();
    for (const p of e.passes) expect(p.enabled).toBe(false);
    e.dispose();
  });

  it("update with blur.enabled=false leaves all passes disabled", () => {
    const e = new BlurEffect();
    const s = makeDefaultSettings();
    s.blur.enabled = false;
    s.blur.strength = 5;
    e.update(s, makeAudio());
    for (const p of e.passes) expect(p.enabled).toBe(false);
    e.dispose();
  });

  it("update with blur.enabled=true and strength>0 enables iterations*2 passes", () => {
    const e = new BlurEffect();
    const s = makeDefaultSettings();
    s.blur.enabled = true;
    s.blur.strength = 4;
    s.blur.iterations = 3;
    s.blur.bassDrive = 0;
    e.update(s, makeAudio());
    const enabledCount = e.passes.filter((p) => p.enabled).length;
    expect(enabledCount).toBe(3 * 2);
    e.dispose();
  });

  it("setSize updates uTexel uniform on all passes", () => {
    const e = new BlurEffect();
    e.setSize(800, 600, 2);
    // texel = 1 / (size * dpr)
    const expectedTexelW = 1 / 1600;
    for (const p of e.passes) {
      const texel = p.uniforms.uTexel!.value as THREE.Vector2;
      expect(texel.x).toBeCloseTo(expectedTexelW, 8);
    }
    e.dispose();
  });

  describe("createPassesForTarget", () => {
    it("returns [] when no passes enabled", () => {
      const e = new BlurEffect();
      const passes = e.createPassesForTarget(256, 144, 1600);
      expect(passes).toEqual([]);
      e.dispose();
    });

    it("returns 2 * iterations passes when blur enabled", () => {
      const e = new BlurEffect();
      const s = makeDefaultSettings();
      s.blur.enabled = true;
      s.blur.strength = 4;
      s.blur.iterations = 2;
      e.update(s, makeAudio());
      const passes = e.createPassesForTarget(256, 144, 1600);
      expect(passes.length).toBe(4);
      e.dispose();
    });

    it("scales radius by targetW/fullSourceW", () => {
      const e = new BlurEffect();
      const s = makeDefaultSettings();
      s.blur.enabled = true;
      s.blur.strength = 8;
      s.blur.iterations = 1;
      s.blur.bassDrive = 0;
      e.update(s, makeAudio());
      const passes = e.createPassesForTarget(256, 144, 1600);
      // base radius = strength * (1 + bass*bassDrive) = 8
      // scale = 256/1600 = 0.16, expected = 8 * 0.16 = 1.28
      for (const p of passes) {
        expect(p.uniforms.uRadius!.value as number).toBeCloseTo(1.28, 4);
      }
      e.dispose();
    });

    it("sets uTexel to 1/target for returned passes", () => {
      const e = new BlurEffect();
      const s = makeDefaultSettings();
      s.blur.enabled = true;
      s.blur.strength = 4;
      s.blur.iterations = 1;
      e.update(s, makeAudio());
      const passes = e.createPassesForTarget(256, 144, 1600);
      for (const p of passes) {
        const texel = p.uniforms.uTexel!.value as THREE.Vector2;
        expect(texel.x).toBeCloseTo(1 / 256, 8);
        expect(texel.y).toBeCloseTo(1 / 144, 8);
      }
      e.dispose();
    });
  });
});
```

- [ ] **Step 2: BlurEffect 実装** — `src/pose-particles/visuals/post/BlurEffect.ts`:

```ts
import * as THREE from "three";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import type { PostEffect, SmoothedAudio } from "./PostEffect";
import type { Settings } from "../../settings";
import { MAX_BLUR_ITERATIONS, effectiveBlurStrength } from "../blur";

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

export class BlurEffect implements PostEffect {
  readonly id = "blur";
  readonly passes: ShaderPass[];
  private blurPairs: BlurPair[] = [];
  private texelW = 1;
  private texelH = 1;

  constructor() {
    const passes: ShaderPass[] = [];
    for (let i = 0; i < MAX_BLUR_ITERATIONS; i++) {
      const horizontal = makeBlurPass(1, 0);
      const vertical = makeBlurPass(0, 1);
      horizontal.enabled = false;
      vertical.enabled = false;
      passes.push(horizontal, vertical);
      this.blurPairs.push({ horizontal, vertical });
    }
    this.passes = passes;
  }

  setSize(w: number, h: number, dpr: number): void {
    this.texelW = 1.0 / Math.max(1, Math.floor(w * dpr));
    this.texelH = 1.0 / Math.max(1, Math.floor(h * dpr));
    for (const pair of this.blurPairs) {
      (pair.horizontal.uniforms.uTexel!.value as THREE.Vector2).set(this.texelW, this.texelH);
      (pair.vertical.uniforms.uTexel!.value as THREE.Vector2).set(this.texelW, this.texelH);
    }
  }

  update(settings: Settings, audio: SmoothedAudio): void {
    const b = settings.blur;
    const radius = effectiveBlurStrength(b, audio.bass);
    const active = radius > 0;
    const iterations = Math.max(1, Math.min(MAX_BLUR_ITERATIONS, Math.round(b.iterations)));
    for (let i = 0; i < this.blurPairs.length; i++) {
      const pair = this.blurPairs[i]!;
      const enabled = active && i < iterations;
      pair.horizontal.enabled = enabled;
      pair.vertical.enabled = enabled;
      pair.horizontal.uniforms.uRadius!.value = radius;
      pair.vertical.uniforms.uRadius!.value = radius;
    }
  }

  createPassesForTarget(
    targetW: number,
    targetH: number,
    fullSourceW: number,
  ): ShaderPass[] {
    const passes: ShaderPass[] = [];
    const texelW = 1 / Math.max(1, targetW);
    const texelH = 1 / Math.max(1, targetH);
    const scale = Math.max(1, targetW) / Math.max(1, fullSourceW);
    for (const pair of this.blurPairs) {
      if (!pair.horizontal.enabled) continue;
      const baseRadius = pair.horizontal.uniforms.uRadius!.value as number;
      if (baseRadius <= 0) continue;
      const radius = baseRadius * scale;
      const h = makeBlurPass(1, 0);
      const v = makeBlurPass(0, 1);
      (h.uniforms.uTexel!.value as THREE.Vector2).set(texelW, texelH);
      (v.uniforms.uTexel!.value as THREE.Vector2).set(texelW, texelH);
      h.uniforms.uRadius!.value = radius;
      v.uniforms.uRadius!.value = radius;
      passes.push(h, v);
    }
    return passes;
  }

  dispose(): void {
    for (const pair of this.blurPairs) {
      pair.horizontal.dispose?.();
      pair.vertical.dispose?.();
    }
  }
}

function makeBlurPass(dx: number, dy: number): ShaderPass {
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
```

- [ ] **Step 3: テスト pass 確認**

Run: `cd /Users/shun/dev/three-art/.worktrees/42-post-effects && bun run test src/pose-particles/visuals/post/BlurEffect.test.ts 2>&1 | tail -15`

Expected: 全件 pass

- [ ] **Step 4: コミット**

```bash
git add src/pose-particles/visuals/post/BlurEffect.ts src/pose-particles/visuals/post/BlurEffect.test.ts
git commit -m "$(cat <<'EOF'
#42 feat: BlurEffect (旧 BlurPipeline の中身を PostEffect 化)

shader と uniform 操作は完全に同一。違いは EffectComposer / RenderPass /
OutputPass を所有しなくなった点 (それらは PostPipeline 側の責務)。
既存 BlurPipeline 由来のテストは BlurEffect 用に移植。

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: PostPipeline を実装 (BlurEffect のみで動作確認, TDD)

**Files:**
- Create: `src/pose-particles/visuals/post/PostPipeline.ts`
- Create: `src/pose-particles/visuals/post/PostPipeline.test.ts`

- [ ] **Step 1: 失敗するテストを書く** — `src/pose-particles/visuals/post/PostPipeline.test.ts`:

```ts
import { describe, it, expect } from "bun:test";
import * as THREE from "three";
import { PostPipeline } from "./PostPipeline";
import { makeDefaultSettings } from "../../settings";

function makePipeline() {
  const renderer = { getPixelRatio: () => 1 } as unknown as THREE.WebGLRenderer;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  return new PostPipeline(renderer, scene, camera);
}

describe("PostPipeline", () => {
  it("constructs with all 3 effects registered", () => {
    const pp = makePipeline();
    expect(pp.hasEffect("blur")).toBe(true);
    expect(pp.hasEffect("kaleidoscope")).toBe(true);
    expect(pp.hasEffect("fractal")).toBe(true);
  });

  it("currentOrder() returns ['blur','kaleidoscope','fractal'] initially", () => {
    const pp = makePipeline();
    expect(pp.currentOrder()).toEqual(["blur", "kaleidoscope", "fractal"]);
  });

  it("syncOrder rebuilds composer when order changes", () => {
    const pp = makePipeline();
    pp.syncOrder(["fractal", "kaleidoscope", "blur"]);
    expect(pp.currentOrder()).toEqual(["fractal", "kaleidoscope", "blur"]);
  });

  it("syncOrder ignores unknown effect ids", () => {
    const pp = makePipeline();
    pp.syncOrder(["nonexistent", "blur", "kaleidoscope", "fractal"]);
    // 未知 ID は無視され、既知のみ順序に残る
    expect(pp.currentOrder()).toEqual(["blur", "kaleidoscope", "fractal"]);
  });

  it("syncOrder is idempotent (same order does not change anything)", () => {
    const pp = makePipeline();
    const before = pp.currentOrder().slice();
    pp.syncOrder(before);
    expect(pp.currentOrder()).toEqual(before);
  });

  describe("update propagates settings.post.order to syncOrder", () => {
    it("changing settings.post.order updates currentOrder after update()", () => {
      const pp = makePipeline();
      const s = makeDefaultSettings();
      s.post.order = ["fractal", "blur", "kaleidoscope"];
      pp.update(s, { volume: 0, bass: 0, mid: 0, treble: 0 });
      expect(pp.currentOrder()).toEqual(["fractal", "blur", "kaleidoscope"]);
    });
  });

  describe("createPassesForTarget", () => {
    it("returns empty when all effects disabled", () => {
      const pp = makePipeline();
      const s = makeDefaultSettings(); // 全 enabled=false
      pp.update(s, { volume: 0, bass: 0, mid: 0, treble: 0 });
      const passes = pp.createPassesForTarget(256, 144, 1600);
      expect(passes).toEqual([]);
    });

    it("returns blur passes when blur enabled, in current order", () => {
      const pp = makePipeline();
      const s = makeDefaultSettings();
      s.blur.enabled = true;
      s.blur.strength = 4;
      s.blur.iterations = 2;
      pp.update(s, { volume: 0, bass: 0, mid: 0, treble: 0 });
      const passes = pp.createPassesForTarget(256, 144, 1600);
      expect(passes.length).toBe(4); // 2 iter × H+V
    });
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd /Users/shun/dev/three-art/.worktrees/42-post-effects && bun run test src/pose-particles/visuals/post/PostPipeline.test.ts 2>&1 | tail -15`

Expected: PostPipeline が存在しないため compile/import エラー

- [ ] **Step 3: PostPipeline 実装** — `src/pose-particles/visuals/post/PostPipeline.ts`:

```ts
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import type { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import type { PostEffect, SmoothedAudio } from "./PostEffect";
import type { Settings } from "../../settings";
import { BlurEffect } from "./BlurEffect";

/**
 * 部品化された post effect を順序付きで直列接続するパイプライン。
 *
 * 順序入れ替え時のみ EffectComposer を再構築 (`rebuild`)。毎フレームの
 * update では `syncOrder` で等価比較し、変化なしなら no-op。サムネ用には
 * `createPassesForTarget` が現在の順序で全 effect 分の独立 pass を生成する。
 */
export class PostPipeline {
  private composer: EffectComposer;
  private renderPass: RenderPass;
  private outputPass: OutputPass;
  private effects: Map<string, PostEffect>;
  private order: string[];

  constructor(
    private renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
  ) {
    this.composer = new EffectComposer(renderer);
    this.renderPass = new RenderPass(scene, camera);
    this.outputPass = new OutputPass();
    this.effects = new Map<string, PostEffect>();
    this.effects.set("blur", new BlurEffect());
    // kaleidoscope / fractal は後続タスクで追加
    this.order = ["blur", "kaleidoscope", "fractal"];
    this.rebuild();
  }

  hasEffect(id: string): boolean {
    return this.effects.has(id);
  }

  currentOrder(): string[] {
    return this.order.slice();
  }

  /** 未知 ID を除外しつつ既知 effect の順序を newOrder の出現順に揃える。 */
  syncOrder(newOrder: string[]): void {
    const filtered: string[] = [];
    const seen = new Set<string>();
    for (const id of newOrder) {
      if (this.effects.has(id) && !seen.has(id)) {
        filtered.push(id);
        seen.add(id);
      }
    }
    // newOrder に欠けている既知 effect は末尾に追加 (drift 防止)
    for (const id of this.effects.keys()) {
      if (!seen.has(id)) filtered.push(id);
    }
    if (arraysEqual(filtered, this.order)) return;
    this.order = filtered;
    this.rebuild();
  }

  private rebuild(): void {
    // EffectComposer.passes を全クリア
    while (this.composer.passes.length > 0) this.composer.removePass(this.composer.passes[0]!);
    this.composer.addPass(this.renderPass);
    for (const id of this.order) {
      const e = this.effects.get(id);
      if (!e) continue;
      for (const p of e.passes) this.composer.addPass(p);
    }
    this.composer.addPass(this.outputPass);
  }

  setSize(w: number, h: number): void {
    this.composer.setSize(w, h);
    const dpr = this.renderer.getPixelRatio();
    for (const e of this.effects.values()) e.setSize(w, h, dpr);
  }

  update(settings: Settings, audio: SmoothedAudio): void {
    this.syncOrder(settings.post.order);
    for (const e of this.effects.values()) e.update(settings, audio);
  }

  render(): void {
    this.composer.render();
  }

  createPassesForTarget(
    targetW: number,
    targetH: number,
    fullSourceW: number,
  ): ShaderPass[] {
    const out: ShaderPass[] = [];
    for (const id of this.order) {
      const e = this.effects.get(id);
      if (!e) continue;
      out.push(...e.createPassesForTarget(targetW, targetH, fullSourceW));
    }
    return out;
  }

  dispose(): void {
    for (const e of this.effects.values()) e.dispose();
    this.outputPass.dispose();
    this.renderPass.dispose?.();
  }
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
```

- [ ] **Step 4: テスト pass 確認**

Run: `cd /Users/shun/dev/three-art/.worktrees/42-post-effects && bun run test src/pose-particles/visuals/post/PostPipeline.test.ts 2>&1 | tail -15`

Expected: 全件 pass

注: PostPipeline は `effects.set("kaleidoscope", ...)` / `"fractal"` をまだ登録していないので、`hasEffect("kaleidoscope")` テストは fail する。kaleidoscope/fractal は Task 5, 6 で追加後に追記する。**この時点で kaleidoscope/fractal のテストは skip するため、それらに `.skip` を付ける**:

```ts
it.skip("constructs with all 3 effects registered", () => { /* ... */ });
it.skip("syncOrder is idempotent ...", () => { /* ... */ });
```

最終 Task で `.skip` を全部外す。

- [ ] **Step 5: 全テスト一旦 pass を確認**

Run: `cd /Users/shun/dev/three-art/.worktrees/42-post-effects && bun run test src/pose-particles/visuals/post/PostPipeline.test.ts 2>&1 | tail -15`

Expected: skip された 2 件以外 pass

- [ ] **Step 6: コミット**

```bash
git add src/pose-particles/visuals/post/PostPipeline.ts src/pose-particles/visuals/post/PostPipeline.test.ts
git commit -m "$(cat <<'EOF'
#42 feat: PostPipeline (順序付き直列 post effect パイプライン)

EffectComposer を 1 本所有し、syncOrder で順序差分のみ rebuild する。
現時点では BlurEffect のみ登録。createPassesForTarget はサムネ用に
現順序で全 effect の pass 列を返す。

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: App.ts を PostPipeline に切り替え (機能等価まま)

この時点では kaleidoscope/fractal はまだ登録されていない (=空登録扱い)。BlurPipeline からの移行のみ確実に動作させる。

**Files:**
- Modify: `src/pose-particles/App.ts`
- Delete: `src/pose-particles/visuals/BlurPipeline.ts`
- Delete: `src/pose-particles/visuals/BlurPipeline.createBlurPassesForTarget.test.ts`

- [ ] **Step 1: App.ts の import 置換**

`src/pose-particles/App.ts:14` を:
```ts
import { BlurPipeline } from "./visuals/BlurPipeline";
```
から:
```ts
import { PostPipeline } from "./visuals/post/PostPipeline";
```

- [ ] **Step 2: フィールド宣言を変更**

`App.ts:46`:
```ts
  readonly blurPipeline: BlurPipeline;
```
→
```ts
  readonly postPipeline: PostPipeline;
```

- [ ] **Step 3: コンストラクタ呼び出しを変更**

`App.ts:84`:
```ts
this.blurPipeline = new BlurPipeline(this.renderer, this.scene, this.camera);
```
→
```ts
this.postPipeline = new PostPipeline(this.renderer, this.scene, this.camera);
```

- [ ] **Step 4: handleResize を変更**

`App.ts:213`:
```ts
this.blurPipeline.setSize(w, h);
```
→
```ts
this.postPipeline.setSize(w, h);
```

- [ ] **Step 5: render 呼び出しを変更**

`App.ts:470`:
```ts
this.blurPipeline.render();
```
→
```ts
this.postPipeline.render();
```

- [ ] **Step 6: update 呼び出しを変更**

`App.ts:580`:
```ts
this.blurPipeline.update(live.blur, this.smoothedAudio.bass);
```
→
```ts
this.postPipeline.update(live, this.smoothedAudio);
```

- [ ] **Step 7: サムネのコメントと呼び出しを変更**

`App.ts:706-709`:
```ts
          // 実画面で適用されている blur をサムネにも再現する。radius/iterations は
          // 現在の BlurPipeline 状態を見て、サムネ RT サイズ向けにスケーリングされる。
          extraPasses: () =>
            this.blurPipeline.createBlurPassesForTarget(thumbW, thumbH, fullDrawingW),
```
→
```ts
          // 実画面で適用されている post effects をサムネにも再現する。各 effect が
          // サムネ RT サイズ向けの独立 pass を生成し、PostPipeline は現順序で連結する。
          extraPasses: () =>
            this.postPipeline.createPassesForTarget(thumbW, thumbH, fullDrawingW),
```

- [ ] **Step 8: 旧 BlurPipeline 関連ファイル削除**

```bash
rm src/pose-particles/visuals/BlurPipeline.ts
rm src/pose-particles/visuals/BlurPipeline.createBlurPassesForTarget.test.ts
```

- [ ] **Step 9: TypeScript / 全テスト確認**

Run: `cd /Users/shun/dev/three-art/.worktrees/42-post-effects && bun run test 2>&1 | tail -10`

Expected: 全件 pass (旧 BlurPipeline 直接参照のテストは消えたので drift 無し)

- [ ] **Step 10: コミット**

```bash
git add -A
git commit -m "$(cat <<'EOF'
#42 refactor: App.ts を BlurPipeline から PostPipeline へ移行

BlurPipeline は削除し、PostPipeline 経由 (現時点では BlurEffect のみ登録)
で同じ blur を実行する。挙動は完全等価。サムネ生成も
createPassesForTarget 経由になり、今後追加する effect 全てを自動で含む。

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: KaleidoscopeEffect を実装 (TDD)

**Files:**
- Create: `src/pose-particles/visuals/post/KaleidoscopeEffect.ts`
- Create: `src/pose-particles/visuals/post/KaleidoscopeEffect.test.ts`
- Modify: `src/pose-particles/visuals/post/PostPipeline.ts` (effects.set 追加)

- [ ] **Step 1: 失敗するテストを書く** — `src/pose-particles/visuals/post/KaleidoscopeEffect.test.ts`:

```ts
import { describe, it, expect } from "bun:test";
import { KaleidoscopeEffect } from "./KaleidoscopeEffect";
import { makeDefaultSettings } from "../../settings";

const ZERO_AUDIO = { volume: 0, bass: 0, mid: 0, treble: 0 };

describe("KaleidoscopeEffect", () => {
  it("id is 'kaleidoscope'", () => {
    const e = new KaleidoscopeEffect();
    expect(e.id).toBe("kaleidoscope");
    e.dispose();
  });

  it("has exactly one ShaderPass", () => {
    const e = new KaleidoscopeEffect();
    expect(e.passes.length).toBe(1);
    e.dispose();
  });

  it("pass disabled initially", () => {
    const e = new KaleidoscopeEffect();
    expect(e.passes[0]!.enabled).toBe(false);
    e.dispose();
  });

  it("update with enabled=false keeps pass disabled even with mix > 0", () => {
    const e = new KaleidoscopeEffect();
    const s = makeDefaultSettings();
    s.post.kaleidoscope.enabled = false;
    s.post.kaleidoscope.mix = 1;
    e.update(s, ZERO_AUDIO);
    expect(e.passes[0]!.enabled).toBe(false);
    e.dispose();
  });

  it("update with enabled=true and mix > 0 enables pass and propagates uniforms", () => {
    const e = new KaleidoscopeEffect();
    const s = makeDefaultSettings();
    s.post.kaleidoscope.enabled = true;
    s.post.kaleidoscope.segments = 8;
    s.post.kaleidoscope.centerX = 0.1;
    s.post.kaleidoscope.centerY = -0.2;
    s.post.kaleidoscope.rotation = 0.5;
    s.post.kaleidoscope.mix = 0.75;
    e.update(s, ZERO_AUDIO);
    const u = e.passes[0]!.uniforms;
    expect(e.passes[0]!.enabled).toBe(true);
    expect(u.uSegments!.value).toBe(8);
    expect((u.uCenter!.value as { x: number; y: number }).x).toBeCloseTo(0.1, 6);
    expect((u.uCenter!.value as { x: number; y: number }).y).toBeCloseTo(-0.2, 6);
    expect(u.uRotation!.value).toBeCloseTo(0.5, 6);
    expect(u.uMix!.value).toBeCloseTo(0.75, 6);
    e.dispose();
  });

  it("update with mix === 0 disables pass (early-out)", () => {
    const e = new KaleidoscopeEffect();
    const s = makeDefaultSettings();
    s.post.kaleidoscope.enabled = true;
    s.post.kaleidoscope.mix = 0;
    e.update(s, ZERO_AUDIO);
    expect(e.passes[0]!.enabled).toBe(false);
    e.dispose();
  });

  it("setSize updates uAspect uniform", () => {
    const e = new KaleidoscopeEffect();
    e.setSize(1600, 900, 1);
    expect(e.passes[0]!.uniforms.uAspect!.value).toBeCloseTo(1600 / 900, 6);
    e.dispose();
  });

  describe("createPassesForTarget", () => {
    it("returns [] when disabled", () => {
      const e = new KaleidoscopeEffect();
      expect(e.createPassesForTarget(256, 144, 1600)).toEqual([]);
      e.dispose();
    });

    it("returns 1 pass when enabled, with target aspect", () => {
      const e = new KaleidoscopeEffect();
      const s = makeDefaultSettings();
      s.post.kaleidoscope.enabled = true;
      s.post.kaleidoscope.segments = 6;
      e.update(s, ZERO_AUDIO);
      const passes = e.createPassesForTarget(256, 144, 1600);
      expect(passes.length).toBe(1);
      expect(passes[0]!.uniforms.uSegments!.value).toBe(6);
      expect(passes[0]!.uniforms.uAspect!.value).toBeCloseTo(256 / 144, 6);
      e.dispose();
    });
  });

  describe("fragment shader sanity", () => {
    it("is ASCII only (Three.js GLSL parser quirks)", () => {
      const src = KaleidoscopeEffect.FRAGMENT_SHADER;
      // eslint-disable-next-line no-control-regex
      expect(/^[\x00-\x7F]*$/.test(src)).toBe(true);
    });

    it("does not use integer modulo (%) at top level (WebGL1)", () => {
      const src = KaleidoscopeEffect.FRAGMENT_SHADER;
      // 単純な含有検査。"mod(" は許容、"%" 単独は禁止
      expect(src.includes("%")).toBe(false);
    });
  });
});
```

- [ ] **Step 2: テスト失敗確認**

Run: `cd /Users/shun/dev/three-art/.worktrees/42-post-effects && bun run test src/pose-particles/visuals/post/KaleidoscopeEffect.test.ts 2>&1 | tail -10`

Expected: import エラー

- [ ] **Step 3: KaleidoscopeEffect 実装** — `src/pose-particles/visuals/post/KaleidoscopeEffect.ts`:

```ts
import * as THREE from "three";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import type { PostEffect, SmoothedAudio } from "./PostEffect";
import type { Settings } from "../../settings";

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform float uSegments;
  uniform vec2 uCenter;
  uniform float uRotation;
  uniform float uAspect;
  uniform float uMix;
  varying vec2 vUv;

  void main() {
    vec2 p = vUv - 0.5 - uCenter;
    p.x *= uAspect;
    float r = length(p);
    float theta = atan(p.y, p.x) + uRotation;
    float seg = 6.28318530718 / max(2.0, uSegments);
    float t = mod(theta, seg);
    if (t > seg * 0.5) t = seg - t;
    vec2 q = vec2(cos(t), sin(t)) * r;
    q.x /= max(0.0001, uAspect);
    q += 0.5 + uCenter;
    vec4 src = texture2D(tDiffuse, vUv);
    vec4 kal = texture2D(tDiffuse, clamp(q, 0.0, 1.0));
    gl_FragColor = mix(src, kal, uMix);
  }
`;

export class KaleidoscopeEffect implements PostEffect {
  static readonly FRAGMENT_SHADER = FRAGMENT;
  readonly id = "kaleidoscope";
  readonly passes: ShaderPass[];

  constructor() {
    const pass = makePass();
    pass.enabled = false;
    this.passes = [pass];
  }

  setSize(w: number, h: number, _dpr: number): void {
    this.passes[0]!.uniforms.uAspect!.value = w / Math.max(1, h);
  }

  update(settings: Settings, _audio: SmoothedAudio): void {
    const k = settings.post.kaleidoscope;
    const pass = this.passes[0]!;
    const active = k.enabled && k.mix > 0;
    pass.enabled = active;
    pass.uniforms.uSegments!.value = Math.max(2, Math.round(k.segments));
    (pass.uniforms.uCenter!.value as THREE.Vector2).set(k.centerX, k.centerY);
    pass.uniforms.uRotation!.value = k.rotation;
    pass.uniforms.uMix!.value = k.mix;
  }

  createPassesForTarget(targetW: number, targetH: number, _fullSourceW: number): ShaderPass[] {
    if (!this.passes[0]!.enabled) return [];
    const p = makePass();
    const src = this.passes[0]!.uniforms;
    p.uniforms.uSegments!.value = src.uSegments!.value;
    (p.uniforms.uCenter!.value as THREE.Vector2).copy(src.uCenter!.value as THREE.Vector2);
    p.uniforms.uRotation!.value = src.uRotation!.value;
    p.uniforms.uMix!.value = src.uMix!.value;
    p.uniforms.uAspect!.value = targetW / Math.max(1, targetH);
    return [p];
  }

  dispose(): void {
    this.passes[0]!.dispose?.();
  }
}

function makePass(): ShaderPass {
  return new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      uSegments: { value: 6 },
      uCenter: { value: new THREE.Vector2(0, 0) },
      uRotation: { value: 0 },
      uAspect: { value: 1 },
      uMix: { value: 1 },
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
  });
}
```

- [ ] **Step 4: PostPipeline に登録** — `src/pose-particles/visuals/post/PostPipeline.ts` の constructor 内 `this.effects.set("blur", new BlurEffect());` の下に追加:

```ts
import { KaleidoscopeEffect } from "./KaleidoscopeEffect";  // 先頭 import に追加
```

```ts
    this.effects.set("kaleidoscope", new KaleidoscopeEffect());
```

- [ ] **Step 5: テスト pass 確認**

Run: `cd /Users/shun/dev/three-art/.worktrees/42-post-effects && bun run test src/pose-particles/visuals/post/ 2>&1 | tail -15`

Expected: KaleidoscopeEffect 全件 pass、PostPipeline テストの kaleidoscope 関連が pass

- [ ] **Step 6: コミット**

```bash
git add src/pose-particles/visuals/post/KaleidoscopeEffect.ts src/pose-particles/visuals/post/KaleidoscopeEffect.test.ts src/pose-particles/visuals/post/PostPipeline.ts
git commit -m "$(cat <<'EOF'
#42 feat: KaleidoscopeEffect (万華鏡 post エフェクト)

中心 (uCenter) からの極座標で θ をセグメント角度に折り畳んでミラーリング。
WebGL1 互換: float mod のみ使用、整数 % なし、ASCII shader のみ。

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: FractalEffect を実装 (TDD)

**Files:**
- Create: `src/pose-particles/visuals/post/FractalEffect.ts`
- Create: `src/pose-particles/visuals/post/FractalEffect.test.ts`
- Modify: `src/pose-particles/visuals/post/PostPipeline.ts`

- [ ] **Step 1: 失敗するテストを書く** — `src/pose-particles/visuals/post/FractalEffect.test.ts`:

```ts
import { describe, it, expect } from "bun:test";
import { FractalEffect } from "./FractalEffect";
import { makeDefaultSettings } from "../../settings";

const ZERO_AUDIO = { volume: 0, bass: 0, mid: 0, treble: 0 };

describe("FractalEffect", () => {
  it("id is 'fractal'", () => {
    const e = new FractalEffect();
    expect(e.id).toBe("fractal");
    e.dispose();
  });

  it("has exactly one ShaderPass, disabled initially", () => {
    const e = new FractalEffect();
    expect(e.passes.length).toBe(1);
    expect(e.passes[0]!.enabled).toBe(false);
    e.dispose();
  });

  it("update with enabled=true and mix>0 enables pass and sets uniforms", () => {
    const e = new FractalEffect();
    const s = makeDefaultSettings();
    s.post.fractal.enabled = true;
    s.post.fractal.iterations = 4;
    s.post.fractal.scale = 0.6;
    s.post.fractal.centerX = -0.1;
    s.post.fractal.centerY = 0.2;
    s.post.fractal.rotation = 0.3;
    s.post.fractal.fade = 0.5;
    s.post.fractal.mix = 0.8;
    e.update(s, ZERO_AUDIO);
    const u = e.passes[0]!.uniforms;
    expect(e.passes[0]!.enabled).toBe(true);
    expect(u.uIterations!.value).toBe(4);
    expect(u.uScale!.value).toBeCloseTo(0.6, 6);
    expect((u.uCenter!.value as { x: number; y: number }).x).toBeCloseTo(-0.1, 6);
    expect((u.uCenter!.value as { x: number; y: number }).y).toBeCloseTo(0.2, 6);
    expect(u.uRotation!.value).toBeCloseTo(0.3, 6);
    expect(u.uFade!.value).toBeCloseTo(0.5, 6);
    expect(u.uMix!.value).toBeCloseTo(0.8, 6);
    e.dispose();
  });

  it("update disables pass when mix=0", () => {
    const e = new FractalEffect();
    const s = makeDefaultSettings();
    s.post.fractal.enabled = true;
    s.post.fractal.mix = 0;
    e.update(s, ZERO_AUDIO);
    expect(e.passes[0]!.enabled).toBe(false);
    e.dispose();
  });

  it("createPassesForTarget returns [] when disabled", () => {
    const e = new FractalEffect();
    expect(e.createPassesForTarget(256, 144, 1600)).toEqual([]);
    e.dispose();
  });

  it("createPassesForTarget returns 1 pass copy when enabled", () => {
    const e = new FractalEffect();
    const s = makeDefaultSettings();
    s.post.fractal.enabled = true;
    s.post.fractal.iterations = 3;
    e.update(s, ZERO_AUDIO);
    const passes = e.createPassesForTarget(256, 144, 1600);
    expect(passes.length).toBe(1);
    expect(passes[0]!.uniforms.uIterations!.value).toBe(3);
    e.dispose();
  });

  describe("fragment shader sanity", () => {
    it("is ASCII only", () => {
      // eslint-disable-next-line no-control-regex
      expect(/^[\x00-\x7F]*$/.test(FractalEffect.FRAGMENT_SHADER)).toBe(true);
    });

    it("uses fixed-bound for loop (WebGL1 ESSL 1.0 constraint)", () => {
      expect(FractalEffect.FRAGMENT_SHADER).toContain("for (int i = 0; i < 6; i++)");
    });

    it("does not use integer modulo (%)", () => {
      expect(FractalEffect.FRAGMENT_SHADER.includes("%")).toBe(false);
    });
  });
});
```

- [ ] **Step 2: テスト失敗確認**

Run: `cd /Users/shun/dev/three-art/.worktrees/42-post-effects && bun run test src/pose-particles/visuals/post/FractalEffect.test.ts 2>&1 | tail -10`

Expected: import エラー

- [ ] **Step 3: FractalEffect 実装** — `src/pose-particles/visuals/post/FractalEffect.ts`:

```ts
import * as THREE from "three";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import type { PostEffect, SmoothedAudio } from "./PostEffect";
import type { Settings } from "../../settings";

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform float uIterations;
  uniform float uScale;
  uniform vec2 uCenter;
  uniform float uRotation;
  uniform float uFade;
  uniform float uMix;
  varying vec2 vUv;

  void main() {
    vec4 acc = vec4(0.0);
    float wsum = 0.0;
    vec2 c = 0.5 + uCenter;
    for (int i = 0; i < 6; i++) {
      if (float(i) >= uIterations) break;
      float k = pow(uScale, float(i));
      float rot = uRotation * float(i);
      float cs = cos(rot);
      float sn = sin(rot);
      vec2 d = vUv - c;
      vec2 r = vec2(d.x * cs - d.y * sn, d.x * sn + d.y * cs);
      vec2 q = r / max(0.0001, k) + c;
      float inside = step(0.0, q.x) * step(q.x, 1.0) * step(0.0, q.y) * step(q.y, 1.0);
      float depthFade = mix(1.0, 1.0 - float(i) / max(1.0, uIterations - 1.0), uFade);
      float w = depthFade * inside;
      acc += texture2D(tDiffuse, q) * w;
      wsum += w;
    }
    vec4 base = texture2D(tDiffuse, vUv);
    vec4 frac = (wsum > 0.0) ? acc / wsum : base;
    gl_FragColor = mix(base, frac, uMix);
  }
`;

export class FractalEffect implements PostEffect {
  static readonly FRAGMENT_SHADER = FRAGMENT;
  readonly id = "fractal";
  readonly passes: ShaderPass[];

  constructor() {
    const pass = makePass();
    pass.enabled = false;
    this.passes = [pass];
  }

  setSize(_w: number, _h: number, _dpr: number): void {
    // UV ベース処理のためサイズ依存無し
  }

  update(settings: Settings, _audio: SmoothedAudio): void {
    const f = settings.post.fractal;
    const pass = this.passes[0]!;
    const active = f.enabled && f.mix > 0;
    pass.enabled = active;
    pass.uniforms.uIterations!.value = Math.max(1, Math.min(6, Math.round(f.iterations)));
    pass.uniforms.uScale!.value = Math.max(0.0001, f.scale);
    (pass.uniforms.uCenter!.value as THREE.Vector2).set(f.centerX, f.centerY);
    pass.uniforms.uRotation!.value = f.rotation;
    pass.uniforms.uFade!.value = f.fade;
    pass.uniforms.uMix!.value = f.mix;
  }

  createPassesForTarget(_targetW: number, _targetH: number, _fullSourceW: number): ShaderPass[] {
    if (!this.passes[0]!.enabled) return [];
    const p = makePass();
    const src = this.passes[0]!.uniforms;
    p.uniforms.uIterations!.value = src.uIterations!.value;
    p.uniforms.uScale!.value = src.uScale!.value;
    (p.uniforms.uCenter!.value as THREE.Vector2).copy(src.uCenter!.value as THREE.Vector2);
    p.uniforms.uRotation!.value = src.uRotation!.value;
    p.uniforms.uFade!.value = src.uFade!.value;
    p.uniforms.uMix!.value = src.uMix!.value;
    return [p];
  }

  dispose(): void {
    this.passes[0]!.dispose?.();
  }
}

function makePass(): ShaderPass {
  return new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      uIterations: { value: 3 },
      uScale: { value: 0.7 },
      uCenter: { value: new THREE.Vector2(0, 0) },
      uRotation: { value: 0 },
      uFade: { value: 0.3 },
      uMix: { value: 1 },
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
  });
}
```

- [ ] **Step 4: PostPipeline 登録 + skip 解除**

`PostPipeline.ts` の import に追加:
```ts
import { FractalEffect } from "./FractalEffect";
```

constructor 内に追加:
```ts
    this.effects.set("fractal", new FractalEffect());
```

`PostPipeline.test.ts` の `.skip` を全て外す。

- [ ] **Step 5: 全 post テスト pass 確認**

Run: `cd /Users/shun/dev/three-art/.worktrees/42-post-effects && bun run test src/pose-particles/visuals/post/ 2>&1 | tail -15`

Expected: 全件 pass

- [ ] **Step 6: 全テスト確認**

Run: `cd /Users/shun/dev/three-art/.worktrees/42-post-effects && bun run test 2>&1 | tail -10`

Expected: param-docs / param-relevance / randomize は新 leaf が未登録なので **fail する想定** (次の Task 8 で修正)

- [ ] **Step 7: コミット**

```bash
git add src/pose-particles/visuals/post/FractalEffect.ts src/pose-particles/visuals/post/FractalEffect.test.ts src/pose-particles/visuals/post/PostPipeline.ts src/pose-particles/visuals/post/PostPipeline.test.ts
git commit -m "$(cat <<'EOF'
#42 feat: FractalEffect (Droste 風再帰縮小コピー post エフェクト)

固定上限 6 段の for ループで縮小回転コピーを加算、深さに応じてフェード。
WebGL1 互換: 固定 for 上限、break のみ uniform 比較、整数 % なし。

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: param-docs / param-relevance / randomize を新 leaf に追従

**Files:**
- Modify: `src/pose-particles/ui/param-docs.ts`
- Modify: `src/pose-particles/ui/param-relevance.ts`
- Modify: `src/pose-particles/ui/randomize.ts`
- Modify: `src/pose-particles/ui/randomize.test.ts`

- [ ] **Step 1: param-relevance.ts に post.* を追加**

`src/pose-particles/ui/param-relevance.ts` の `"blur.bassDrive": new Set(ALL),` の下に追加:

```ts
  // post effects (Issue #42): blur と同様に全 mode で効く
  "post.order": new Set(ALL),
  "post.kaleidoscope.enabled": new Set(ALL),
  "post.kaleidoscope.segments": new Set(ALL),
  "post.kaleidoscope.centerX": new Set(ALL),
  "post.kaleidoscope.centerY": new Set(ALL),
  "post.kaleidoscope.rotation": new Set(ALL),
  "post.kaleidoscope.mix": new Set(ALL),
  "post.fractal.enabled": new Set(ALL),
  "post.fractal.iterations": new Set(ALL),
  "post.fractal.scale": new Set(ALL),
  "post.fractal.centerX": new Set(ALL),
  "post.fractal.centerY": new Set(ALL),
  "post.fractal.rotation": new Set(ALL),
  "post.fractal.fade": new Set(ALL),
  "post.fractal.mix": new Set(ALL),
```

- [ ] **Step 2: param-docs.ts に post.* を追加**

`src/pose-particles/ui/param-docs.ts` の `"blur.bassDrive": { ... },` の下に追加:

```ts
  "post.order": {
    summary: "post effect の適用順 (先頭から順に適用)。",
    effect: "順を入れ替えると同じ on/off 構成でも見栄えが変わる。SettingsPanel の ↑↓ で編集する。",
  },

  "post.kaleidoscope.enabled": {
    summary: "万華鏡 (kaleidoscope) post エフェクトの ON/OFF。",
    effect: "ON で画面が中心から N 個の扇形に折り畳まれ円周状に対称化される。",
  },
  "post.kaleidoscope.segments": {
    summary: "万華鏡の扇形セグメント数 (2..16、整数)。",
    effect: "上げるほど細かく刻まれた多角的な対称模様になる。下げると太い分割で粗い対称になる。",
  },
  "post.kaleidoscope.centerX": {
    summary: "万華鏡の中心 X オフセット (-0.5..0.5、画面中央=0)。",
    effect: "+で右寄り、−で左寄りの中心となり、対称軸位置が変わる。",
  },
  "post.kaleidoscope.centerY": {
    summary: "万華鏡の中心 Y オフセット (-0.5..0.5)。",
    effect: "+で上寄り、−で下寄り (UV 座標基準)。",
  },
  "post.kaleidoscope.rotation": {
    summary: "万華鏡パターン全体の回転 (rad)。",
    effect: "値を変えると対称模様が時計回り/反時計回りに回る。",
  },
  "post.kaleidoscope.mix": {
    summary: "元映像と万華鏡映像のブレンド率 (0..1)。",
    effect: "1 で完全に万華鏡、0 で元映像のみ (実質 OFF)。中間で薄く重なる。",
  },

  "post.fractal.enabled": {
    summary: "フラクタル増殖 (Droste 風再帰縮小) post エフェクトの ON/OFF。",
    effect: "ON で縮小コピーが自己相似で重なり、画面に無限増殖感が出る。",
  },
  "post.fractal.iterations": {
    summary: "フラクタルの再帰回数 (1..6、整数)。",
    effect: "上げるほど深い増殖で複雑になる。描画負荷も増える。",
  },
  "post.fractal.scale": {
    summary: "各反復の縮小率 (0.5..0.95)。",
    effect: "1 に近いほどコピーが大きく、自己相似がゆったり。0.5 に近いほど急激に縮む。",
  },
  "post.fractal.centerX": {
    summary: "フラクタルの収束中心 X (-0.5..0.5)。",
    effect: "+で右寄り、−で左寄りに収束する。",
  },
  "post.fractal.centerY": {
    summary: "フラクタルの収束中心 Y (-0.5..0.5)。",
    effect: "+で上寄り、−で下寄りに収束する。",
  },
  "post.fractal.rotation": {
    summary: "反復ごとの回転 (rad)。",
    effect: "0 以外で螺旋的に巻きながら縮む。",
  },
  "post.fractal.fade": {
    summary: "深い反復ほど暗くするフェード (0..1)。",
    effect: "1 で最深層が黒に、0 で全反復が等しい明度。",
  },
  "post.fractal.mix": {
    summary: "元映像とフラクタル映像のブレンド率 (0..1)。",
    effect: "1 で完全にフラクタル、0 で元映像のみ。",
  },
```

- [ ] **Step 3: randomize.ts に post.* descriptor 追加**

`src/pose-particles/ui/randomize.ts` の `num("blur.bassDrive", 0, 3, 0.05, ALL),` の下に追加:

```ts
  // post effects (Issue #42)。SettingsPanel と値域を一致させる。
  bool("post.kaleidoscope.enabled", ALL),
  num("post.kaleidoscope.segments", 2, 16, 1, ALL),
  num("post.kaleidoscope.centerX", -0.5, 0.5, 0.01, ALL),
  num("post.kaleidoscope.centerY", -0.5, 0.5, 0.01, ALL),
  num("post.kaleidoscope.rotation", -Math.PI, Math.PI, 0.01, ALL),
  num("post.kaleidoscope.mix", 0, 1, 0.01, ALL),
  bool("post.fractal.enabled", ALL),
  num("post.fractal.iterations", 1, 6, 1, ALL),
  num("post.fractal.scale", 0.5, 0.95, 0.01, ALL),
  num("post.fractal.centerX", -0.5, 0.5, 0.01, ALL),
  num("post.fractal.centerY", -0.5, 0.5, 0.01, ALL),
  num("post.fractal.rotation", -Math.PI, Math.PI, 0.01, ALL),
  num("post.fractal.fade", 0, 1, 0.01, ALL),
  num("post.fractal.mix", 0, 1, 0.01, ALL),
```

- [ ] **Step 4: randomize.test.ts の `isExcluded` に `post.order` 追加**

`src/pose-particles/ui/randomize.test.ts:67` の `isExcluded`:

```ts
    const isExcluded = (p: string): boolean =>
      p === "mode" || p.startsWith("auto.") || p === "image.preset";
```

→

```ts
    const isExcluded = (p: string): boolean =>
      p === "mode" || p.startsWith("auto.") || p === "image.preset" || p === "post.order";
```

そしてコメントを追加 (line 63 付近、既存除外コメントの近く):

```ts
   * - `post.order`: 適用順は ↑↓ ボタンで明示編集する性質のため randomize 対象外 (Issue #42)
```

- [ ] **Step 5: 全テスト pass 確認**

Run: `cd /Users/shun/dev/three-art/.worktrees/42-post-effects && bun run test 2>&1 | tail -10`

Expected: 全件 pass

- [ ] **Step 6: コミット**

```bash
git add src/pose-particles/ui/param-relevance.ts src/pose-particles/ui/param-docs.ts src/pose-particles/ui/randomize.ts src/pose-particles/ui/randomize.test.ts
git commit -m "$(cat <<'EOF'
#42 feat: post.* を param-docs / param-relevance / randomize に登録

drift 防止テスト (settings 全 leaf 網羅) に追従。post.order は ↑↓ ボタンで
明示編集する性質のため randomize 除外宣言を追加。

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: SettingsPanel に Post effects フォルダと ↑↓ ボタンを追加

**Files:**
- Modify: `src/pose-particles/ui/SettingsPanel.ts`

- [ ] **Step 1: GATED_GROUPS に post を追加 (kaleidoscope/fractal の enabled 連動 disable のため)**

実は post は `settings.post.kaleidoscope.enabled` / `settings.post.fractal.enabled` という 2 階層構造で、既存 GATED_GROUPS の 1 階層モデル (`twist/blur/edges/auto`) と合わない。

→ 簡略化: GATED_GROUPS は触らず、kaleidoscope / fractal は **独立フォルダ** として `.enabled` を toggle すれば pass 側で early-out するので、UI gating 無しでも実害なし (既存 twist/blur/edges/auto と同じ「全パラメータ常時編集可、ON で反映」体験と統一)。

`GATED_GROUPS` は触らないので Step 1 は **何もしない** で次に進む。

- [ ] **Step 2: Post-process フォルダ内の Blur フォルダを置換**

`src/pose-particles/ui/SettingsPanel.ts` の line 213-217 の Blur フォルダ部分を削除し、以下に置換:

```ts
    // ---- Post effects (Issue #42) ----
    // 順序入れ替え可能な部品化 post パイプライン。Blur / Kaleidoscope / Fractal
    // の 3 effect が直列接続される。
    const postFx = post.addFolder("Post effects");

    // 順序コントロール: ↑↓ で settings.post.order を入れ替える。
    // ラベルは現在の順序を反映するので動的更新。
    const orderFolder = postFx.addFolder("Order (top → applied first)");
    type OrderRow = { up: () => void; down: () => void; label: string };
    const orderRows: Record<string, OrderRow> = {};
    const moveEffect = (id: string, direction: -1 | 1): void => {
      const order = settings.post.order;
      const idx = order.indexOf(id);
      if (idx < 0) return;
      const target = idx + direction;
      if (target < 0 || target >= order.length) return;
      const tmp = order[idx]!;
      order[idx] = order[target]!;
      order[target] = tmp;
      onSettingsChanged(); // localStorage 保存 + PostPipeline syncOrder は次フレームで反映
      refreshOrderLabels();
    };
    const refreshOrderLabels = (): void => {
      for (let i = 0; i < settings.post.order.length; i++) {
        const id = settings.post.order[i]!;
        const row = orderRows[id];
        if (!row) continue;
        row.label = `${i + 1}. ${id}`;
      }
      // lil-gui コントローラのラベル更新は再描画が必要なので、各 button を作り直さず
      // controller.name() で更新する: 後段で配列を保持しているので updateAll() を呼ぶ。
      orderControllerUpdaters.forEach((fn) => fn());
    };
    const orderControllerUpdaters: Array<() => void> = [];
    for (const id of ["blur", "kaleidoscope", "fractal"]) {
      const row: OrderRow = {
        up: () => moveEffect(id, -1),
        down: () => moveEffect(id, +1),
        label: id,
      };
      orderRows[id] = row;
      // 表示用の dummy オブジェクト + button 2 個 (↑/↓)
      const upCtrl = orderFolder.add({ [`↑ ${id}`]: row.up }, `↑ ${id}`);
      const downCtrl = orderFolder.add({ [`↓ ${id}`]: row.down }, `↓ ${id}`);
      orderControllerUpdaters.push(() => {
        const i = settings.post.order.indexOf(id);
        const pos = i < 0 ? "?" : String(i + 1);
        upCtrl.name(`↑ ${pos}. ${id}`);
        downCtrl.name(`↓ ${pos}. ${id}`);
      });
    }
    refreshOrderLabels();

    const blur = postFx.addFolder("Blur");
    blur.add(settings.blur, "enabled").name("enabled").onChange(() => this.applyActivation());
    blur.add(settings.blur, "strength", 0, 30, 0.1).name("strength (px)");
    blur.add(settings.blur, "iterations", 1, 6, 1).name("iterations");
    blur.add(settings.blur, "bassDrive", 0, 3, 0.05).name("bass drive");

    const kal = postFx.addFolder("Kaleidoscope");
    kal.add(settings.post.kaleidoscope, "enabled").name("enabled");
    kal.add(settings.post.kaleidoscope, "segments", 2, 16, 1).name("segments");
    kal.add(settings.post.kaleidoscope, "centerX", -0.5, 0.5, 0.01).name("center X");
    kal.add(settings.post.kaleidoscope, "centerY", -0.5, 0.5, 0.01).name("center Y");
    kal.add(settings.post.kaleidoscope, "rotation", -Math.PI, Math.PI, 0.01).name("rotation (rad)");
    kal.add(settings.post.kaleidoscope, "mix", 0, 1, 0.01).name("mix");

    const frac = postFx.addFolder("Fractal (Droste)");
    frac.add(settings.post.fractal, "enabled").name("enabled");
    frac.add(settings.post.fractal, "iterations", 1, 6, 1).name("iterations");
    frac.add(settings.post.fractal, "scale", 0.5, 0.95, 0.01).name("scale");
    frac.add(settings.post.fractal, "centerX", -0.5, 0.5, 0.01).name("center X");
    frac.add(settings.post.fractal, "centerY", -0.5, 0.5, 0.01).name("center Y");
    frac.add(settings.post.fractal, "rotation", -Math.PI, Math.PI, 0.01).name("rotation (rad)");
    frac.add(settings.post.fractal, "fade", 0, 1, 0.01).name("fade");
    frac.add(settings.post.fractal, "mix", 0, 1, 0.01).name("mix");
```

- [ ] **Step 3: `onSettingsChanged` の参照箇所を確認**

`SettingsPanel.ts` の constructor シグネチャに `onSettingsChanged` がない場合は、既存の `onSettingChange` callback を探して同じ呼び方をする。

Run: `cd /Users/shun/dev/three-art/.worktrees/42-post-effects && grep -n "saveSettings\|onSettingsChanged\|onSettingChange" src/pose-particles/ui/SettingsPanel.ts | head -10`

その結果を見て、上の `onSettingsChanged()` 呼び出しを正しい関数名/フィールド名 (例: `this.onSettingsChanged()` あるいは `saveSettings(settings)`) に書き換える。**典型は `saveSettings(settings)` の直接呼び出し**:

```ts
import { saveSettings } from "../settings";
// ...
const moveEffect = (id: string, direction: -1 | 1): void => {
  // ...
  saveSettings(settings);
  refreshOrderLabels();
};
```

- [ ] **Step 4: TypeScript & テスト確認**

Run: `cd /Users/shun/dev/three-art/.worktrees/42-post-effects && bunx tsc --noEmit 2>&1 | tail -10`

Expected: エラーなし

Run: `cd /Users/shun/dev/three-art/.worktrees/42-post-effects && bun run test 2>&1 | tail -10`

Expected: 全件 pass

- [ ] **Step 5: dev サーバ起動 + ブラウザでの手動確認 (ユーザ依頼前の自己確認)**

Run: `cd /Users/shun/dev/three-art/.worktrees/42-post-effects && bun run dev` (バックグラウンドで起動)

ブラウザで http://localhost:5173 を開き:
1. Post-process → Post effects → Order に ↑/↓ ボタンが効果 ID 表示されている
2. Blur の enabled を ON → 滲み確認
3. Kaleidoscope の enabled を ON、segments=8 → 8 セグメント万華鏡確認
4. Fractal の enabled を ON、iterations=4 → 縮小コピー確認
5. ↑↓ で順序入れ替え → 見た目変化確認 (例: kaleidoscope-first vs blur-first)
6. 順序ボタンのラベルが入れ替えのたびに番号更新される

すべて OK ならサーバ停止。

- [ ] **Step 6: コミット**

```bash
git add src/pose-particles/ui/SettingsPanel.ts
git commit -m "$(cat <<'EOF'
#42 feat: SettingsPanel に Post effects フォルダと ↑↓ 順序ボタンを追加

旧 'Blur (post-process)' フォルダを 'Post effects' に置換し、3 effect の
サブフォルダと Order サブフォルダを配置。↑↓ ボタンが settings.post.order を
編集し、PostPipeline.update が次フレームで syncOrder する。

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: 最終クリーンアップ + 全テスト + push

**Files:** —

- [ ] **Step 1: 旧 BlurPipeline 参照が残っていないか確認**

Run: `cd /Users/shun/dev/three-art/.worktrees/42-post-effects && grep -rn "BlurPipeline" src/ 2>&1 | head -10`

Expected: ヒット 0 件 (完全に置換済み)

- [ ] **Step 2: 全テスト最終確認**

Run: `cd /Users/shun/dev/three-art/.worktrees/42-post-effects && bun run test 2>&1 | tail -10`

Expected: 全件 pass

- [ ] **Step 3: TypeScript & lint 確認**

Run: `cd /Users/shun/dev/three-art/.worktrees/42-post-effects && bunx tsc --noEmit 2>&1 | tail -10`

Expected: 0 errors

- [ ] **Step 4: コミット (まだ残っていれば) + push**

```bash
git status
git push -u origin feature/42-post-effects
```

---

## Self-Review

- [x] **Spec coverage**:
  - PostEffect / PostPipeline 部品化 → Task 2, 4
  - BlurEffect 移植 → Task 3
  - KaleidoscopeEffect → Task 6
  - FractalEffect → Task 7
  - settings.post 追加 → Task 1
  - SettingsPanel ↑↓ → Task 9
  - サムネ互換 (createPassesForTarget) → Task 3, 4, 6, 7 (各 effect のテストで検証)
  - randomize / param-docs / param-relevance → Task 8
  - WebGL1 罠回避 → 各 shader のテストで ASCII / 整数 % 不使用を検証
  - 旧 BlurPipeline 削除 → Task 5

- [x] **Placeholder scan**: なし

- [x] **Type consistency**:
  - PostEffect.id は readonly string → Task 2, 3, 6, 7 で一致
  - SmoothedAudio 型は Task 2 で定義し以降全 effect で参照
  - settings.post.order は string[] → Task 1, 4, 9 で一致
  - createPassesForTarget(targetW, targetH, fullSourceW) シグネチャ → Task 2, 3, 4, 6, 7 で一致

- [x] **Spec で言及した AutomationMap 更新は不要と判明**: AutomationMap.test.ts は固定 target リストしか強制しないため、post.* を STYLE_PRESETS に追加しなくても build/test は通る。デフォルト挙動 (auto モードで kaleidoscope/fractal を勝手に触らない) を維持するため、追加しない方が安全。spec のリスク欄に従う形でこの判断を採用。
