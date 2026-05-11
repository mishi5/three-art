# lattice 描画モード Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

- 対象 Issue: https://github.com/mishi5/three-art/issues/14
- 設計ドキュメント: `docs/plans/2026-05-11-lattice-render-mode-design.md`
- ブランチ: feature/14-lattice-mode
- 作成日: 2026-05-11

**Goal:** `RenderMode` に 4 つ目の `lattice` を追加。立方体ボリュームの N×N×N 厳密格子に粒子を並べ、bass の onset で中心から外向きの shockwave を伝播させ、粒子は弾性振動しながら格子位置へ復帰する。

**Architecture:** GLSL vertex shader に lattice 分岐を追加。`uWaveTimes[4]` uniform に直近 4 個の onset 時刻を入れ、`exp(-waveAge/τ)·sin(2πf·waveAge)` で displacement を計算するステートレス設計。onset 検出は CPU 側に純粋ロジックの `OnsetDetector` を新設。

**Tech Stack:** TypeScript (Bun), Three.js (WebGL1/2 互換), GLSL, lil-gui, bun test

**コミット規約:** すべてのコミットメッセージは `#14 ...` プレフィクス必須 (`.claude/rules/git.md` 参照)。

---

## File Structure

**新規ファイル:**
- `src/pose-particles/audio/OnsetDetector.ts` — bass の onset 検出 + 直近 4 個の ring buffer
- `src/pose-particles/audio/OnsetDetector.test.ts` — 上のユニットテスト
- `src/pose-particles/settings.test.ts` — RenderMode/LatticeSettings の回帰テスト

**変更ファイル:**
- `src/pose-particles/settings.ts` — `RenderMode` 拡張、`LatticeSettings`、`modeToInt`、`MOTION_TARGETS`、defaults
- `src/pose-particles/visuals/PointCloud.ts` — `aIndex` attribute、shader に lattice 分岐 + shockwave、新 uniform、setter API
- `src/pose-particles/App.ts` — `OnsetDetector` インスタンスとループ統合
- `src/pose-particles/visuals/EdgeOverlay.ts` — `mode === "lattice"` で早期 return
- `src/pose-particles/visuals/EdgeOverlay.test.ts` — lattice ガードのテスト
- `src/pose-particles/ui/SettingsPanel.ts` — mode dropdown 自動拡張 + Lattice フォルダ追加

---

## Task 1: settings に RenderMode "lattice" と LatticeSettings を追加

**Files:**
- Modify: `src/pose-particles/settings.ts`
- Create: `src/pose-particles/settings.test.ts`

- [ ] **Step 1: テストファイルを作成 (失敗するテスト)**

`src/pose-particles/settings.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import {
  RENDER_MODES,
  modeToInt,
  makeDefaultSettings,
  MOTION_TARGETS,
} from "./settings";

describe("RenderMode", () => {
  test("RENDER_MODES に lattice が含まれ全 4 値", () => {
    expect(RENDER_MODES.length).toBe(4);
    expect(RENDER_MODES).toContain("lattice");
  });

  test("modeToInt は lattice=3 を返す", () => {
    expect(modeToInt("lattice")).toBe(3);
    expect(modeToInt("bones")).toBe(0);
    expect(modeToInt("cube")).toBe(1);
    expect(modeToInt("sphere")).toBe(2);
  });
});

describe("LatticeSettings defaults", () => {
  test("makeDefaultSettings に lattice が含まれ妥当な範囲", () => {
    const s = makeDefaultSettings();
    expect(s.lattice.resolution).toBe(12);
    expect(s.lattice.waveSpeed).toBeGreaterThan(0);
    expect(s.lattice.waveAmplitude).toBeGreaterThan(0);
    expect(s.lattice.waveOscFreq).toBeGreaterThan(0);
    expect(s.lattice.waveDamping).toBeGreaterThan(0);
    expect(s.lattice.onsetThreshold).toBeGreaterThan(0);
    expect(s.lattice.onsetCooldown).toBeGreaterThan(0);
  });
});

describe("MOTION_TARGETS", () => {
  test("lattice.waveAmplitude と lattice.waveOscFreq を含む", () => {
    expect(MOTION_TARGETS).toContain("lattice.waveAmplitude");
    expect(MOTION_TARGETS).toContain("lattice.waveOscFreq");
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `bun test src/pose-particles/settings.test.ts`
Expected: FAIL (RENDER_MODES.length=3 / modeToInt 未対応 / s.lattice undefined / MOTION_TARGETS に新キー無し)

- [ ] **Step 3: `settings.ts` を更新**

- 10 行目付近: `RenderMode` に `"lattice"` 追加
  ```ts
  export type RenderMode = "bones" | "cube" | "sphere" | "lattice";
  export const RENDER_MODES: ReadonlyArray<RenderMode> = ["bones", "cube", "sphere", "lattice"];
  ```

- 38 行目付近の `MOTION_TARGETS` に 2 つ追加 (リスト末尾 `"blur.strength"` の後に):
  ```ts
  "lattice.waveAmplitude",
  "lattice.waveOscFreq",
  ```

- 42 行目付近の `modeToInt` を switch ベースに書き換え:
  ```ts
  export function modeToInt(mode: RenderMode): number {
    switch (mode) {
      case "bones": return 0;
      case "cube": return 1;
      case "sphere": return 2;
      case "lattice": return 3;
    }
  }
  ```

- `Settings` interface (62 行目付近) に `lattice` プロパティと `LatticeSettings` 型を追加:
  ```ts
  export interface LatticeSettings {
    /** 格子解像度 NxNxN。8..17 */
    resolution: number;
    /** 波速度 (m/s)。0.5..3.0 */
    waveSpeed: number;
    /** 弾性振動の最大変位 (m)。0..0.5 */
    waveAmplitude: number;
    /** 振動周波数 (Hz)。1..10 */
    waveOscFreq: number;
    /** 減衰時定数 (sec)。0.1..1.5 */
    waveDamping: number;
    /** onset しきい値 (1 フレームの bass 増分)。0.02..0.5 */
    onsetThreshold: number;
    /** onset クールダウン (sec)。0.05..0.5 */
    onsetCooldown: number;
  }
  ```
  そして `Settings` に `lattice: LatticeSettings;` を追加 (`blur: BlurSettings;` の直後あたり)。

- `makeDefaultSettings()` (225 行目付近) の return 内に追加:
  ```ts
  lattice: {
    resolution: 12,
    waveSpeed: 1.2,
    waveAmplitude: 0.15,
    waveOscFreq: 4.0,
    waveDamping: 0.4,
    onsetThreshold: 0.15,
    onsetCooldown: 0.12,
  },
  ```

- [ ] **Step 4: テストがパスすることを確認**

Run: `bun test src/pose-particles/settings.test.ts`
Expected: PASS (3 件)

- [ ] **Step 5: 全テスト回帰**

Run: `bun test`
Expected: 全件 PASS (107 + 3 = 110 件想定)

- [ ] **Step 6: コミット**

```bash
git add src/pose-particles/settings.ts src/pose-particles/settings.test.ts
git commit -m "$(cat <<'EOF'
#14 feat: RenderMode に lattice を追加 + LatticeSettings 定義

RENDER_MODES を 4 値化し modeToInt(lattice)=3、Settings に lattice
セクションを追加。MOTION_TARGETS に lattice.waveAmplitude /
lattice.waveOscFreq を追加して body motion でも駆動可能に。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: PointCloud に aIndex attribute と lattice 静的格子 shader 分岐

このタスクは GPU 上のロジックなのでユニットテスト不能。コンパイル成功 + 目視 = "lattice モードで厳密格子が見える" で確認。波の挙動は Task 4 で追加。

**Files:**
- Modify: `src/pose-particles/visuals/PointCloud.ts`

- [ ] **Step 1: BufferGeometry に `aIndex` attribute を追加**

`constructor` 内 (220 行目付近、`seeds` Float32Array の生成箇所の隣) に:

```ts
const indices01 = new Float32Array(total);  // 既存の indices と区別するため別名
const aIndexArr = new Float32Array(total);
for (let j = 0; j < NUM_JOINTS; j++) {
  for (let p = 0; p < POINTS_PER_JOINT; p++) {
    const i = j * POINTS_PER_JOINT + p;
    aIndexArr[i] = i;
  }
}
```

(`offsets`/`indices`/`seeds` を埋めるループ内で `aIndexArr[i] = i` を 1 行足すだけでも可。一行追加方式を採用する場合は新 Float32Array だけ宣言してループに混ぜ込む。)

`geom.setAttribute("aSeed", ...)` の次の行に:
```ts
geom.setAttribute("aIndex", new THREE.BufferAttribute(aIndexArr, 1));
```

- [ ] **Step 2: vertex shader の attribute 宣言を追加**

shader 文字列の attribute 宣言部 (39-41 行目付近) に追加:

```glsl
attribute float aIndex;
```

- [ ] **Step 3: 新 uniform `uLatticeN` を宣言**

shader の uniform 宣言部 (25 行目付近、`uMode` の下) に追加:

```glsl
uniform float uLatticeN;        // 格子解像度
```

uniforms 初期化 (261 行目付近、`uMode: { value: 0.0 }` の隣) に追加:

```ts
uLatticeN: { value: 12.0 },
```

- [ ] **Step 4: shader の `uMode` 分岐に lattice ブランチを追加**

既存の `} else { /* sphere */ ... }` の閉じ括弧の直前に、`else if (uMode < 2.5)` で sphere を別ブランチに切り出し、最後の `else` を lattice にする:

```glsl
} else if (uMode < 2.5) {
  // sphere: 既存ロジックそのまま
  vec3 r = hash3unit(aSeed * 7.0 + aJointIndex + 1.0);
  float theta = r.x * 6.2831853;
  float cosPhi = 2.0 * r.y - 1.0;
  float sinPhi = sqrt(max(0.0, 1.0 - cosPhi * cosPhi));
  vec3 dir = vec3(sinPhi * cos(theta), sinPhi * sin(theta), cosPhi);
  float radius = uShapeRadius * (1.0 + uBass * uShapeBassPulse) * outlier;
  pos = dir * radius + dir * shimmer;
  visAlpha = 0.85;
} else {
  // lattice: NxNxN 厳密格子。bass shockwave は Task 4 で追加。
  int idx = int(aIndex + 0.5);
  int N = int(uLatticeN + 0.5);
  int N3 = N * N * N;
  if (idx >= N3) {
    pos = vec3(0.0);
    visAlpha = 0.0;
  } else {
    int ix = idx - (idx / N) * N;
    int iy = (idx / N) - (idx / (N * N)) * N;
    int iz = idx / (N * N);
    vec3 cell = vec3(float(ix), float(iy), float(iz));
    float cellSize = uShapeRadius * 2.0 / max(float(N - 1), 1.0);
    vec3 latticePos = (cell - vec3(float(N - 1) * 0.5)) * cellSize;
    vec3 outwardDir = normalize(latticePos + vec3(1e-5));
    pos = latticePos + outwardDir * shimmer;
    visAlpha = 0.85;
  }
}
```

(注: WebGL1 環境では `%` 整数演算が無いので `idx - (idx / N) * N` で代用済み)

- [ ] **Step 5: setter API を追加して settings から uniform に反映**

`update(...)` メソッド (310 行目付近、`u.uMode!.value = ...` の下) に追加:

```ts
u.uLatticeN!.value = settings.lattice.resolution;
```

- [ ] **Step 6: 既存テスト全件パス確認**

Run: `bun test`
Expected: 全件 PASS (110 件)

- [ ] **Step 7: 開発サーバで lattice モードを目視確認**

Run: `bun --hot ./pose-particles.html`
ブラウザで開き → 「開始」→ Settings パネルの mode dropdown で `lattice` を選択。
Expected: 立方体ボリューム内に厳密格子状の粒子が並ぶ。bones/cube/sphere に切り替えると元通り動作。

サーバは Ctrl+C で停止。

- [ ] **Step 8: コミット**

```bash
git add src/pose-particles/visuals/PointCloud.ts
git commit -m "$(cat <<'EOF'
#14 feat: PointCloud に lattice 静的格子分岐と aIndex attribute

vertex shader の uMode 分岐に lattice ブランチを追加し、aIndex
attribute と uLatticeN uniform を使って NxNxN 厳密格子に粒子を配置。
波の挙動は次タスクで追加。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: OnsetDetector の実装

**Files:**
- Create: `src/pose-particles/audio/OnsetDetector.ts`
- Create: `src/pose-particles/audio/OnsetDetector.test.ts`

- [ ] **Step 1: テストファイルを作成**

`src/pose-particles/audio/OnsetDetector.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { OnsetDetector } from "./OnsetDetector";

describe("OnsetDetector", () => {
  test("初期状態は全 wave inactive (-1)", () => {
    const d = new OnsetDetector();
    expect(d.getWaveTimes()).toEqual([-1, -1, -1, -1]);
  });

  test("threshold を超える delta で 1 回発火", () => {
    const d = new OnsetDetector();
    d.update(0.0, 0.1, 0.12, 0.0);
    d.update(0.5, 0.1, 0.12, 0.1);   // delta=0.5 > 0.1
    const times = d.getWaveTimes();
    expect(times[0]).toBeCloseTo(0.1, 6);
    expect(times[1]).toBe(-1);
  });

  test("threshold 以下では発火しない", () => {
    const d = new OnsetDetector();
    d.update(0.0, 0.2, 0.12, 0.0);
    d.update(0.1, 0.2, 0.12, 0.05);  // delta=0.1 < 0.2
    expect(d.getWaveTimes()).toEqual([-1, -1, -1, -1]);
  });

  test("cooldown 内の 2 回目は無視される", () => {
    const d = new OnsetDetector();
    d.update(0.0, 0.1, 0.12, 0.0);
    d.update(0.5, 0.1, 0.12, 0.1);   // 発火 @ 0.1
    d.update(0.0, 0.1, 0.12, 0.15);  // bassPrev=0.5, delta=-0.5
    d.update(0.5, 0.1, 0.12, 0.18);  // delta=0.5 だが cooldown 内 (0.18-0.1=0.08 < 0.12)
    const times = d.getWaveTimes();
    expect(times[0]).toBeCloseTo(0.1, 6);
    expect(times[1]).toBe(-1);
  });

  test("cooldown 経過後の発火は正常に記録される", () => {
    const d = new OnsetDetector();
    d.update(0.0, 0.1, 0.12, 0.0);
    d.update(0.5, 0.1, 0.12, 0.1);   // 発火 @ 0.1
    d.update(0.0, 0.1, 0.12, 0.3);   // bassPrev=0.5
    d.update(0.5, 0.1, 0.12, 0.4);   // 発火 @ 0.4 (cooldown 0.12 経過)
    const times = d.getWaveTimes();
    expect(times[0]).toBeCloseTo(0.1, 6);
    expect(times[1]).toBeCloseTo(0.4, 6);
  });

  test("5 回目の発火で ring buffer の最古値が上書きされる", () => {
    const d = new OnsetDetector();
    const fire = (t: number) => {
      d.update(0.0, 0.1, 0.12, t);
      d.update(0.5, 0.1, 0.12, t + 0.001);
    };
    fire(0.0);  // → index 0
    fire(0.2);  // → index 1
    fire(0.4);  // → index 2
    fire(0.6);  // → index 3
    fire(0.8);  // → index 0 上書き
    const times = d.getWaveTimes();
    expect(times[0]).toBeCloseTo(0.801, 6);
    expect(times[1]).toBeCloseTo(0.201, 6);
    expect(times[2]).toBeCloseTo(0.401, 6);
    expect(times[3]).toBeCloseTo(0.601, 6);
  });

  test("reset で全 wave がクリアされ bassPrev/lastOnsetTime もリセット", () => {
    const d = new OnsetDetector();
    d.update(0.0, 0.1, 0.12, 0.0);
    d.update(0.5, 0.1, 0.12, 0.1);
    d.reset();
    expect(d.getWaveTimes()).toEqual([-1, -1, -1, -1]);
    d.update(0.0, 0.1, 0.12, 0.2);
    d.update(0.5, 0.1, 0.12, 0.21);
    expect(d.getWaveTimes()[0]).toBeCloseTo(0.21, 6);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `bun test src/pose-particles/audio/OnsetDetector.test.ts`
Expected: FAIL (`Cannot find module './OnsetDetector'`)

- [ ] **Step 3: 実装ファイルを作成**

`src/pose-particles/audio/OnsetDetector.ts`:

```ts
const MAX_WAVES = 4;

export class OnsetDetector {
  private bassPrev = 0;
  private lastOnsetTime = -Infinity;
  private waves: number[] = [-1, -1, -1, -1];
  private writeIdx = 0;

  update(bass: number, threshold: number, cooldownSec: number, nowSec: number): void {
    const delta = bass - this.bassPrev;
    this.bassPrev = bass;
    if (delta > threshold && nowSec - this.lastOnsetTime > cooldownSec) {
      this.waves[this.writeIdx] = nowSec;
      this.writeIdx = (this.writeIdx + 1) % MAX_WAVES;
      this.lastOnsetTime = nowSec;
    }
  }

  getWaveTimes(): readonly number[] {
    return this.waves;
  }

  reset(): void {
    this.bassPrev = 0;
    this.lastOnsetTime = -Infinity;
    this.writeIdx = 0;
    for (let i = 0; i < MAX_WAVES; i++) this.waves[i] = -1;
  }
}
```

- [ ] **Step 4: テストがパスすることを確認**

Run: `bun test src/pose-particles/audio/OnsetDetector.test.ts`
Expected: PASS (7 件)

- [ ] **Step 5: 全テスト回帰**

Run: `bun test`
Expected: 全件 PASS (117 件想定)

- [ ] **Step 6: コミット**

```bash
git add src/pose-particles/audio/OnsetDetector.ts src/pose-particles/audio/OnsetDetector.test.ts
git commit -m "$(cat <<'EOF'
#14 feat: OnsetDetector を追加 (bass 微分 + クールダウン + ring buffer)

直近 4 個までの bass onset 時刻を保持する純粋ロジック。
threshold/cooldown は呼び出し側から毎フレーム渡す形にして
settings 変更が即時反映される。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: PointCloud に shockwave displacement と App.ts 統合

このタスクも GPU ロジック中心。動作確認は目視。

**Files:**
- Modify: `src/pose-particles/visuals/PointCloud.ts`
- Modify: `src/pose-particles/App.ts`

- [ ] **Step 1: shader に shockwave 用 uniform 宣言を追加**

`PointCloud.ts` の shader 文字列の uniform 宣言部に追加:

```glsl
uniform float uWaveTimes[4];
uniform float uWaveSpeed;
uniform float uWaveAmplitude;
uniform float uWaveOscFreq;
uniform float uWaveDamping;
```

- [ ] **Step 2: shader の lattice ブランチに shockwave displacement を実装**

Task 2 で書いた lattice ブランチの `pos = latticePos + outwardDir * shimmer;` を以下に置き換え:

```glsl
float r = length(latticePos);
float totalDisp = 0.0;
for (int i = 0; i < 4; i++) {
  float t0 = uWaveTimes[i];
  if (t0 < 0.0) continue;
  float waveAge = (uTime - t0) - r / uWaveSpeed;
  if (waveAge < 0.0) continue;
  float env = exp(-waveAge / uWaveDamping);
  float osc = sin(waveAge * uWaveOscFreq * 6.2831853);
  totalDisp += uWaveAmplitude * env * osc;
}
pos = latticePos + outwardDir * totalDisp;
pos += outwardDir * shimmer;
```

- [ ] **Step 3: uniforms 初期化に shockwave uniform を追加**

`new THREE.ShaderMaterial({... uniforms: {...}})` 内、`uLatticeN` の隣に追加:

```ts
uWaveTimes: { value: new Float32Array([-1, -1, -1, -1]) },
uWaveSpeed: { value: 1.2 },
uWaveAmplitude: { value: 0.15 },
uWaveOscFreq: { value: 4.0 },
uWaveDamping: { value: 0.4 },
```

- [ ] **Step 4: `update(...)` 内で settings から uniform に反映**

Task 2 で追加した `u.uLatticeN!.value = settings.lattice.resolution;` の直下に:

```ts
u.uWaveSpeed!.value = settings.lattice.waveSpeed;
u.uWaveAmplitude!.value = settings.lattice.waveAmplitude;
u.uWaveOscFreq!.value = settings.lattice.waveOscFreq;
u.uWaveDamping!.value = settings.lattice.waveDamping;
```

- [ ] **Step 5: `PointCloud` に `setWaveTimes` メソッドを追加**

`update(...)` メソッドの直後あたりに:

```ts
setWaveTimes(times: readonly number[]): void {
  const arr = this.material.uniforms.uWaveTimes!.value as Float32Array;
  for (let i = 0; i < 4; i++) arr[i] = times[i] ?? -1;
}
```

- [ ] **Step 6: `App.ts` に OnsetDetector を組み込む**

import 部に追加:

```ts
import { OnsetDetector } from "./audio/OnsetDetector";
```

App クラスのフィールド宣言部に:

```ts
private onsetDetector = new OnsetDetector();
```

`update(audio: AudioFeatures)` メソッド内、smoothing 適用後の `bass` 値を使って onset 検出する。`pointCloud.update(...)` の呼び出し直前に以下を挿入:

```ts
const nowSec = performance.now() / 1000;
this.onsetDetector.update(
  this.smoothedAudio.bass,
  this.settings.lattice.onsetThreshold,
  this.settings.lattice.onsetCooldown,
  nowSec,
);
this.pointCloud.setWaveTimes(this.onsetDetector.getWaveTimes());
```

(注: `this.smoothedAudio.bass` および `this.settings` の正確な参照名は既存コードで確認すること。`gainedAudio.bass` の方が適切なら差し替える。)

曲切替時のリセットを既存の song-change ハンドラに追加 (もし存在すれば):

```ts
this.onsetDetector.reset();
```

- [ ] **Step 7: 全テスト回帰**

Run: `bun test`
Expected: 全件 PASS (117 件)

- [ ] **Step 8: 開発サーバで動作確認**

Run: `bun --hot ./pose-particles.html`
ブラウザで lattice モードに切替 → bass の効いた曲を再生。
Expected: bass がドンと鳴った瞬間に中心から外向きに shockwave が伝播し、粒子が振動して格子位置へ戻る。連打すると複数の波が並走する。

サーバは Ctrl+C で停止。

- [ ] **Step 9: コミット**

```bash
git add src/pose-particles/visuals/PointCloud.ts src/pose-particles/App.ts
git commit -m "$(cat <<'EOF'
#14 feat: lattice モードに bass トリガー shockwave を追加

OnsetDetector の wave times を uWaveTimes[4] に渡し、
shader 内で exp 減衰 × sin 振動の弾性復帰を実装。中心から
外向きに波面が伝播する絵になる。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: EdgeOverlay の lattice ガード

**Files:**
- Modify: `src/pose-particles/visuals/EdgeOverlay.ts`
- Modify: `src/pose-particles/visuals/EdgeOverlay.test.ts`

- [ ] **Step 1: 失敗するテストを追加**

`src/pose-particles/visuals/EdgeOverlay.test.ts` の末尾に追加:

```ts
describe("EdgeOverlay lattice mode", () => {
  test("mode=lattice では edges.enabled=true でも描画されない", () => {
    const overlay = new EdgeOverlay();
    const settings = makeDefaultSettings();
    settings.edges.enabled = true;
    settings.edges.anchorCount = 16;
    settings.mode = "lattice";
    const joints = makeEmptyJoints();
    const center = new Float32Array([0, 0, 0]);
    const audio = makeAudio();

    overlay.update(joints, center, audio, settings, 0.5);

    expect(overlay.object3D.visible).toBe(false);
  });

  test("mode=sphere に戻すと edges.enabled=true で描画再開", () => {
    const overlay = new EdgeOverlay();
    const settings = makeDefaultSettings();
    settings.edges.enabled = true;
    settings.edges.anchorCount = 16;
    settings.mode = "lattice";
    const joints = makeEmptyJoints();
    const center = new Float32Array([0, 0, 0]);
    const audio = makeAudio();

    overlay.update(joints, center, audio, settings, 0.5);
    expect(overlay.object3D.visible).toBe(false);

    settings.mode = "sphere";
    overlay.update(joints, center, audio, settings, 0.5);
    expect(overlay.object3D.visible).toBe(true);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `bun test src/pose-particles/visuals/EdgeOverlay.test.ts`
Expected: 上記 2 件のみ FAIL (lattice モードでも `visible=true` になる)

- [ ] **Step 3: `EdgeOverlay.ts` に lattice ガードを追加**

`update(...)` メソッドの先頭 (`const e = settings.edges;` の直後) に挿入:

```ts
if (settings.mode === "lattice") {
  this.object3D.visible = false;
  return;
}
```

- [ ] **Step 4: テストがパスすることを確認**

Run: `bun test src/pose-particles/visuals/EdgeOverlay.test.ts`
Expected: 全件 PASS

- [ ] **Step 5: 全テスト回帰**

Run: `bun test`
Expected: 全件 PASS (119 件)

- [ ] **Step 6: コミット**

```bash
git add src/pose-particles/visuals/EdgeOverlay.ts src/pose-particles/visuals/EdgeOverlay.test.ts
git commit -m "$(cat <<'EOF'
#14 feat: lattice モードで EdgeOverlay を自動 OFF

規則的な格子の k-NN edges は視覚的に美麗でないため、lattice 時は
描画をスキップ。edges.enabled の設定値は維持し、他モードに戻れば
即座に復帰する。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: SettingsPanel に Lattice フォルダを追加

mode dropdown は `RENDER_MODES` を spread しているので Task 1 で自動拡張済み。本タスクでは Lattice フォルダのみ追加。

**Files:**
- Modify: `src/pose-particles/ui/SettingsPanel.ts`

- [ ] **Step 1: Lattice フォルダを追加**

`SettingsPanel.ts` の `Shape` フォルダ追加箇所 (54 行目付近) の直後に挿入:

```ts
const lattice = this.gui.addFolder("Lattice (lattice mode)");
lattice.add(settings.lattice, "resolution", 8, 17, 1).name("resolution NxNxN");
lattice.add(settings.lattice, "waveSpeed", 0.5, 3.0, 0.05).name("wave speed (m/s)");
lattice.add(settings.lattice, "waveAmplitude", 0.0, 0.5, 0.005).name("wave amplitude (m)");
lattice.add(settings.lattice, "waveOscFreq", 1.0, 10.0, 0.1).name("osc freq (Hz)");
lattice.add(settings.lattice, "waveDamping", 0.1, 1.5, 0.01).name("damping (sec)");
lattice.add(settings.lattice, "onsetThreshold", 0.02, 0.5, 0.005).name("onset threshold");
lattice.add(settings.lattice, "onsetCooldown", 0.05, 0.5, 0.005).name("onset cooldown (sec)");
lattice.close();
```

- [ ] **Step 2: 全テスト回帰**

Run: `bun test`
Expected: 全件 PASS (119 件)

- [ ] **Step 3: 開発サーバで UI 動作確認**

Run: `bun --hot ./pose-particles.html`
Expected:
- mode dropdown に "lattice" が選べる
- Lattice フォルダが現れて 7 つの slider が表示される
- 各 slider を動かすと lattice の挙動が即座に変わる
- リロード後も localStorage から設定が復元される

サーバは Ctrl+C で停止。

- [ ] **Step 4: コミット**

```bash
git add src/pose-particles/ui/SettingsPanel.ts
git commit -m "$(cat <<'EOF'
#14 feat: SettingsPanel に Lattice フォルダを追加

resolution / wave speed / amplitude / osc freq / damping /
onset threshold / cooldown の 7 slider を提供。mode dropdown は
RENDER_MODES の自動展開で lattice が選べるようになっている。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: 最終回帰確認 + 動作シナリオの目視

**Files:** なし

- [ ] **Step 1: 全テスト実行**

Run: `bun test`
Expected: 全件 PASS (119 件)

- [ ] **Step 2: 動作シナリオを目視確認**

Run: `bun --hot ./pose-particles.html`

ブラウザで以下を確認:
- [ ] bones モードで挙動が変わっていない (joint クラスタ + bass expansion)
- [ ] cube モードで挙動が変わっていない (立方体表面)
- [ ] sphere モードで挙動が変わっていない (球面)
- [ ] lattice モードで厳密格子が見える
- [ ] bass の効いた曲で shockwave が中心から伝播し粒子が振動して戻る
- [ ] 連打しても 4 波が並走して破綻しない
- [ ] twist を ON にすると格子全体がねじれる
- [ ] blur を ON にすると lattice もぼける
- [ ] outlier boost で一部粒子がトゲ状に動く
- [ ] motion target を `lattice.waveAmplitude` にすると体の動きで振幅が変わる
- [ ] EdgeOverlay は lattice 時に表示されない、他モードでは復帰する
- [ ] localStorage が新キーで再生成される (devtools の Application タブで確認)

問題なければ次に進む。問題があれば該当タスクに戻って修正。

- [ ] **Step 3: ブランチをリモートにプッシュ**

```bash
git push -u origin feature/14-lattice-mode
```

- [ ] **Step 4: PR を作成**

```bash
gh pr create --title "#14 feat: lattice 描画モード (bass トリガー shockwave) を追加" \
  --body "$(cat <<'EOF'
## Summary
- 立方体ボリューム内の N×N×N 厳密格子に粒子を配置する新モード `lattice` を追加
- bass の onset を検出 (微分 + クールダウン + ring buffer 4 個) して中心から外向きに shockwave を伝播
- 粒子は弾性振動 (sin × exp 減衰) で格子位置に復帰、波は最大 4 つまで重ね合わせ
- EdgeOverlay は lattice 時に自動 OFF、SettingsPanel に Lattice フォルダ追加
- 既存の twist / blur / outlier / motion target / hue 等はすべて lattice にも作用

詳細設計: `docs/plans/2026-05-11-lattice-render-mode-design.md`
実装計画: `docs/superpowers/plans/2026-05-11-lattice-render-mode.md`

Issue: https://github.com/mishi5/three-art/issues/14

## Test plan
- [x] `bun test` 全件パス (119 件)
- [ ] bones / cube / sphere の挙動が変わっていない (目視)
- [ ] lattice で厳密格子が見える (目視)
- [ ] bass で shockwave が中心から伝播し粒子が弾性復帰する (目視)
- [ ] 4 波並走で破綻しない (目視)
- [ ] twist / blur / outlier / motion target が lattice でも動く (目視)
- [ ] EdgeOverlay は lattice 時に非表示、他モードでは復帰する (目視)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

(PR 本文に `Closes #14` / `Fixes #14` を**書かない** — マージで自動クローズされるのを避けるため。`.claude/rules/git.md` 参照。)

- [ ] **Step 5: ユーザに動作確認を依頼**

ブラウザで PR の差分を確認してもらい、上記目視シナリオを実機で試してもらう。OK 出れば次へ。

- [ ] **Step 6: PR マージ → Issue クローズ → 後片付け**

ユーザ OK 後:

```bash
gh pr merge --merge --delete-branch
gh issue comment 14 --repo mishi5/three-art --body "## 対応内容
- \`src/pose-particles/settings.ts\`: RenderMode に lattice を追加、LatticeSettings 定義
- \`src/pose-particles/visuals/PointCloud.ts\`: shader に lattice 分岐と shockwave displacement、aIndex attribute
- \`src/pose-particles/audio/OnsetDetector.ts\`: bass onset 検出 + ring buffer (新規)
- \`src/pose-particles/App.ts\`: OnsetDetector のループ統合
- \`src/pose-particles/visuals/EdgeOverlay.ts\`: lattice 時に描画スキップ
- \`src/pose-particles/ui/SettingsPanel.ts\`: Lattice フォルダ追加
- \`docs/plans/2026-05-11-lattice-render-mode-design.md\`: 設計ドキュメント
- \`docs/superpowers/plans/2026-05-11-lattice-render-mode.md\`: 実装計画

新規テスト: settings (3 件) + OnsetDetector (7 件) + EdgeOverlay lattice ガード (2 件) = 12 件追加。全 119 件パス。"
gh issue close 14 --repo mishi5/three-art
```

worktree と branch を削除し、main を pull:

```bash
git -C /Users/shun/dev/three-art worktree remove .worktrees/14-lattice-mode
git -C /Users/shun/dev/three-art branch -D feature/14-lattice-mode
git -C /Users/shun/dev/three-art -C /Users/shun/dev/three-art pull --ff-only origin main
```

---

## 補足: 実装中に出るかもしれない罠

- **WebGL1 互換**: `aIndex` から整数演算を取り出すときは `idx - (idx / N) * N` を使う (modulo `%` は WebGL1 整数で動かないことがある)。`int(aIndex + 0.5)` で四捨五入。
- **動的 uniform array indexing**: `uWaveTimes[i]` のループは `const int` でカウンタ回す前提 (`for (int i = 0; i < 4; i++)`)。`uniform` 値や非定数で indexing しないこと (threejs-art skill 参照)。
- **`audioSmoothing` 後の bass**: App.ts の `smoothedAudio.bass` は smoothing 済み。OnsetDetector に渡すのは smoothing **後** の値で OK (リップル抑制)。生の値を使うとシャープすぎて threshold チューニングが難しい。
- **localStorage**: `migrate()` 関数を弄る必要はない。既存の `deepMerge(defaults, parsed)` が `lattice` キーを自動補完する。
- **コミット粒度**: 各 task の最後でコミットする。途中で詰まったら作業内容を保存しないまま試行錯誤しないこと。
