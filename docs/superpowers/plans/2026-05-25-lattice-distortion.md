# lattice 形状歪み Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

- 対象 Issue: https://github.com/mishi5/three-art/issues/41
- spec: `docs/superpowers/specs/2026-05-25-lattice-distortion-design.md`

**Goal:** lattice モードに「ベース形状 (cube/sphere) + 連続的な形状歪み (3D ノイズ warp / twist+bend+taper / ripple)」を追加する。

**Architecture:** `LatticeSettings` に 9 個の新フィールドを追加し、`PointCloud` の vertex shader 内 lattice 分岐に `basePos → 軸変形 → ノイズ warp → ripple → shockwave 重畳` の計算順で適用する。simplex noise は shader 内に直書きする。SettingsPanel の `Mode > Lattice` フォルダに dropdown と "Distortion" 子フォルダを追加する。

**Tech Stack:** TypeScript (strict), Three.js 0.170, GLSL (WebGL1/2), Bun test, lil-gui.

## 依存・規約メモ (実装前に必ず読む)

- **テストコマンド**: `bun run test` (= `bun test --isolate`)。`bun test` 直叩きは readonly エラーで 20 件落ちるので使わない。
- **コミットメッセージ**: 先頭に `#41` を付け、Co-Authored-By トレイラを入れる (例: `git commit -m "#41 feat: ...\n\nCo-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"`)。
- **GLSL の罠 (threejs-art skill 由来)**:
  - `int` uniform を使わない (uniform は float、shader 内で int 化)
  - 動的 uniform 配列 indexing をしない (今回は固定ループのみ)
  - ASCII-only。`° µ π` などを GLSL 文字列に書かない (コメントも避ける)
  - `renderer.setSize` の第 3 引数は触らない (今回は無関係)
- **drift 検知テスト**: Settings に leaf を追加すると `randomize.test.ts`「covers every Settings leaf」/ `param-relevance.test.ts`「全 leaf パスが登録済み」/ `param-docs.test.ts`「every GUI parameter has a ParamDoc entry」が同時に失敗する。**3 箇所への登録を 1 タスクにまとめる**ことで TDD のサイクルを短く保つ。

---

## File Structure

新規:
- *(なし)* — spec 通り `lattice.*` を平坦拡張するだけ。新ファイルは増えない。

修正:
- `src/pose-particles/settings.ts` — `LatticeSettings` に 9 フィールド追加 / defaults / `MOTION_TARGETS` に 4 エントリ追加
- `src/pose-particles/settings.test.ts` — 新フィールドの defaults アサーション追加
- `src/pose-particles/ui/randomize.ts` — `RANDOMIZE_DESCRIPTORS` に 9 エントリ追加
- `src/pose-particles/ui/randomize.test.ts` — モード別代表テスト (任意、coverage テストは自動でカバー)
- `src/pose-particles/ui/param-relevance.ts` — `RELEVANCE` に 9 エントリ追加 (全て `["lattice"]`)
- `src/pose-particles/ui/param-docs.ts` — `PARAM_DOCS` に 9 エントリ追加
- `src/pose-particles/visuals/PointCloud.ts` — vertex shader に simplex noise 追加 / lattice 分岐に基底形状 + 軸変形 + ノイズ + ripple / uniform 9 個追加 / `update()` で settings → uniform を反映
- `src/pose-particles/ui/SettingsPanel.ts` — Lattice フォルダに baseShape dropdown と Distortion サブフォルダ追加

---

## Task 1: settings 拡張 + meta テーブル登録 (1 コミット)

**目的:** `LatticeSettings` に 9 フィールドを追加し、drift 検知テスト (randomize / param-relevance / param-docs) と settings.test.ts を全て green に保つ。shader/UI には触らない (デフォルトは「歪みなし」なので視覚的変化なし)。

**Files:**
- Modify: `src/pose-particles/settings.ts`
- Modify: `src/pose-particles/settings.test.ts`
- Modify: `src/pose-particles/ui/randomize.ts`
- Modify: `src/pose-particles/ui/param-relevance.ts`
- Modify: `src/pose-particles/ui/param-docs.ts`

### Step 1.1: settings.test.ts に失敗するテストを追加

`src/pose-particles/settings.test.ts` の `describe("LatticeSettings defaults", ...)` ブロック (40-51 行目あたり) の直後 (52 行目あたり) に新規 describe ブロックを追加。

```ts
describe("LatticeSettings distortion defaults (Issue #41)", () => {
  test("baseShape はデフォルト 'cube' (現状互換)", () => {
    const s = makeDefaultSettings();
    expect(s.lattice.baseShape).toBe("cube");
  });

  test("歪み系パラメータは全て『歪みなし』のデフォルト値", () => {
    const s = makeDefaultSettings();
    expect(s.lattice.noiseAmount).toBe(0);
    expect(s.lattice.twist).toBe(0);
    expect(s.lattice.bend).toBe(0);
    expect(s.lattice.taper).toBe(1);
    expect(s.lattice.rippleAmp).toBe(0);
  });

  test("歪み系の周波数/seed はデフォルトでも妥当な正数", () => {
    const s = makeDefaultSettings();
    expect(s.lattice.noiseScale).toBeGreaterThan(0);
    expect(Number.isInteger(s.lattice.noiseSeed)).toBe(true);
    expect(s.lattice.noiseSeed).toBeGreaterThan(0);
    expect(s.lattice.rippleFreq).toBeGreaterThan(0);
  });

  test("MOTION_TARGETS に歪み系の Amount/twist/bend/ripple が含まれる", () => {
    expect(MOTION_TARGETS).toContain("lattice.noiseAmount");
    expect(MOTION_TARGETS).toContain("lattice.twist");
    expect(MOTION_TARGETS).toContain("lattice.bend");
    expect(MOTION_TARGETS).toContain("lattice.rippleAmp");
  });
});
```

### Step 1.2: テストを走らせて全部 fail することを確認

```
cd /Users/shun/dev/three-art/.worktrees/41-lattice-distortion && bun run test 2>&1 | tail -30
```

期待:
- `LatticeSettings distortion defaults` 4 件 fail (型エラーで file 全体が compile fail する形で落ちる可能性あり)
- ベースライン 301 - 失敗件数 = pass

### Step 1.3: `LatticeSettings` 型に 9 フィールドを追加

`src/pose-particles/settings.ts` の既存 `LatticeSettings` (82-97 行目) を以下に差し替える。

```ts
export type LatticeBaseShape = "cube" | "sphere";

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
  // --- 形状歪み (Issue #41) ---
  /** ベース形状。"cube" は現状互換 (NxNxN 立方格子)、"sphere" は cube-to-sphere マッピング。 */
  baseShape: LatticeBaseShape;
  /** ノイズ warp の空間周波数 (1/m)。0.1..3.0。 */
  noiseScale: number;
  /** ノイズ warp の振幅 (m)。0..0.5。0 で歪みなし。 */
  noiseAmount: number;
  /** ノイズ warp のシード (1..16 整数)。形を変えるキー。 */
  noiseSeed: number;
  /** y 軸まわりのねじり (rad/m)。-π..+π。0 で歪みなし。 */
  twist: number;
  /** y 軸まわりの曲げ (rad/m)。-π/4..+π/4。0 で歪みなし。 */
  bend: number;
  /** 上下スケール差。0.3..1.7。1.0 で歪みなし。 */
  taper: number;
  /** ripple の空間周波数 (1/m)。0.5..6.0。 */
  rippleFreq: number;
  /** ripple の振幅 (m)。0..0.3。0 で歪みなし。 */
  rippleAmp: number;
}
```

### Step 1.4: `MOTION_TARGETS` に 4 エントリ追加

同ファイルの `MOTION_TARGETS` 配列 (15-43 行目)。`"lattice.waveOscFreq",` の直後 (40 行目) に挿入。

```ts
  "lattice.waveAmplitude",
  "lattice.waveOscFreq",
  "lattice.noiseAmount",
  "lattice.twist",
  "lattice.bend",
  "lattice.rippleAmp",
  "image.pushAmount",
```

### Step 1.5: `makeDefaultSettings()` の `lattice` を拡張

同ファイル `makeDefaultSettings()` 内 `lattice:` (401-409 行目) を以下に差し替える。

```ts
    lattice: {
      resolution: 12,
      waveSpeed: 1.2,
      waveAmplitude: 0.15,
      waveOscFreq: 4.0,
      waveDamping: 0.4,
      onsetThreshold: 0.15,
      onsetCooldown: 0.12,
      // 形状歪み (Issue #41) — デフォルトは「歪みなし」で従来挙動と完全互換
      baseShape: "cube",
      noiseScale: 1.0,
      noiseAmount: 0.0,
      noiseSeed: 1,
      twist: 0.0,
      bend: 0.0,
      taper: 1.0,
      rippleFreq: 2.0,
      rippleAmp: 0.0,
    },
```

### Step 1.6: `randomize.ts` に descriptor を 9 件追加

`src/pose-particles/ui/randomize.ts` の lattice 専用ブロック (127-129 行目あたり、`// --- lattice 専用 ---` セクション) の末尾 (`num("lattice.waveAmplitude", ...)` の次行) に追加。

```ts
  // --- lattice 形状歪み (Issue #41) ---
  enm("lattice.baseShape", ["cube", "sphere"], LATTICE),
  num("lattice.noiseScale", 0.5, 2.5, 0.05, LATTICE),
  num("lattice.noiseAmount", 0.0, 0.3, 0.005, LATTICE),
  num("lattice.noiseSeed", 1, 16, 1, LATTICE),
  num("lattice.twist", -Math.PI, Math.PI, 0.05, LATTICE),
  num("lattice.bend", -Math.PI / 4, Math.PI / 4, 0.02, LATTICE),
  num("lattice.taper", 0.5, 1.5, 0.02, LATTICE),
  num("lattice.rippleFreq", 1.0, 4.0, 0.1, LATTICE),
  num("lattice.rippleAmp", 0.0, 0.15, 0.005, LATTICE),
```

### Step 1.7: `param-relevance.ts` に 9 エントリ追加

`src/pose-particles/ui/param-relevance.ts` の `RELEVANCE` map 内、`"lattice.onsetCooldown": new Set(["lattice"]),` (97 行目あたり) の直後に追加。

```ts
  // 形状歪み (Issue #41): 全て lattice 専用
  "lattice.baseShape": new Set(["lattice"]),
  "lattice.noiseScale": new Set(["lattice"]),
  "lattice.noiseAmount": new Set(["lattice"]),
  "lattice.noiseSeed": new Set(["lattice"]),
  "lattice.twist": new Set(["lattice"]),
  "lattice.bend": new Set(["lattice"]),
  "lattice.taper": new Set(["lattice"]),
  "lattice.rippleFreq": new Set(["lattice"]),
  "lattice.rippleAmp": new Set(["lattice"]),
```

### Step 1.8: `param-docs.ts` に 9 エントリ追加

`src/pose-particles/ui/param-docs.ts` の `"lattice.onsetCooldown"` エントリ (317-320 行目あたり) の直後に追加。

```ts
  "lattice.baseShape": {
    summary: "lattice のベース形状 (cube / sphere)。Issue #41。",
    effect: "cube は立方格子。sphere は格子全体を球体ボリュームにマッピングする。",
  },
  "lattice.noiseScale": {
    summary: "ノイズ warp の空間周波数 (1/m)。",
    effect: "上げるほど細かいうねりに、下げるほど大ぶりなうねりになる。",
  },
  "lattice.noiseAmount": {
    summary: "ノイズ warp の振幅 (m, 0..0.5)。",
    effect: "上げるほど格子が連続的にうねって歪む。0 でノイズ歪みなし。",
  },
  "lattice.noiseSeed": {
    summary: "ノイズのシード (整数)。",
    effect: "変えると別のうねり形になる。形は変えたいが量は変えたくないときに使う。",
  },
  "lattice.twist": {
    summary: "y 軸まわりのねじり (rad/m)。",
    effect: "上下に行くほど xz 平面が回転する。0 でねじりなし。",
  },
  "lattice.bend": {
    summary: "y 軸まわりの曲げ (rad/m)。",
    effect: "上下に行くほど xy 平面で傾く (片側に倒れる)。0 で曲げなし。",
  },
  "lattice.taper": {
    summary: "上下スケール差 (0.5..1.5)。",
    effect: "1 より大きいと上が広がり下がすぼまる、小さいと逆。1.0 で歪みなし。",
  },
  "lattice.rippleFreq": {
    summary: "ripple の空間周波数 (1/m)。",
    effect: "上げるほど細かい凹凸、下げるほど大きな凹凸になる。",
  },
  "lattice.rippleAmp": {
    summary: "ripple の振幅 (m, 0..0.3)。",
    effect: "上げるほど三角関数的な凹凸が強く出る。0 で ripple なし。",
  },
```

### Step 1.9: 全テスト実行

```
cd /Users/shun/dev/three-art/.worktrees/41-lattice-distortion && bun run test 2>&1 | tail -10
```

期待: `301 + 4 = 305 pass / 0 fail`。

- [ ] **失敗ケース対応**: もし `randomize.test.ts` の「covers every Settings leaf」が落ちたら descriptor 漏れ。`param-relevance.test.ts` の「全 leaf パス登録済み」が落ちたら relevance 漏れ。`param-docs.test.ts` の「every ParamDoc entry」が落ちたら docs 漏れ。エラーメッセージの `missing: [...]` を見て該当 path を追加。

### Step 1.10: コミット

```bash
cd /Users/shun/dev/three-art/.worktrees/41-lattice-distortion
git add src/pose-particles/settings.ts \
        src/pose-particles/settings.test.ts \
        src/pose-particles/ui/randomize.ts \
        src/pose-particles/ui/param-relevance.ts \
        src/pose-particles/ui/param-docs.ts
git commit -m "#41 feat: LatticeSettings に baseShape + 形状歪み 9 フィールドを追加

- baseShape (cube/sphere), noiseScale/Amount/Seed, twist/bend/taper,
  rippleFreq/Amp の 9 フィールドを LatticeSettings に追加 (defaults は全て
  歪みなし= 従来挙動互換)
- MOTION_TARGETS に lattice.noiseAmount / twist / bend / rippleAmp を追加
- randomize / param-relevance / param-docs に同 9 エントリを反映
- shader / UI は次タスクで対応 (このコミットでは視覚的変化なし)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: shader uniform 追加 + JS 側の値伝達 (挙動変化なし)

**目的:** 後続タスクで shader が参照する uniform を準備する。lattice ブランチには `vec3 shapePos = latticePos;` の rename だけ入れて、以降の `latticePos` 参照を `shapePos` に置換 (挙動は完全に同じ)。

**Files:**
- Modify: `src/pose-particles/visuals/PointCloud.ts`

### Step 2.1: shader にuniform 宣言を追加

`PointCloud.ts` の vertex shader 宣言ブロック (uLatticeN の次、30 行目あたり) に以下を追加。

```glsl
  uniform float uLatticeBaseShape;       // 0=cube, 1=sphere
  uniform float uLatticeNoiseScale;
  uniform float uLatticeNoiseAmount;
  uniform float uLatticeNoiseSeed;
  uniform float uLatticeTwist;
  uniform float uLatticeBend;
  uniform float uLatticeTaper;
  uniform float uLatticeRippleFreq;
  uniform float uLatticeRippleAmp;
```

挿入位置: `uniform float uLatticeN;` 行の直後。

### Step 2.2: shader uniforms{} 初期値ブロックに 9 エントリ追加

ShaderMaterial の uniforms オブジェクト (408 行目 `uLatticeN: { value: 12.0 },` の直後) に追加。

```ts
        uLatticeN: { value: 12.0 },
        uLatticeBaseShape: { value: 0.0 },     // cube
        uLatticeNoiseScale: { value: 1.0 },
        uLatticeNoiseAmount: { value: 0.0 },
        uLatticeNoiseSeed: { value: 1.0 },
        uLatticeTwist: { value: 0.0 },
        uLatticeBend: { value: 0.0 },
        uLatticeTaper: { value: 1.0 },
        uLatticeRippleFreq: { value: 2.0 },
        uLatticeRippleAmp: { value: 0.0 },
```

### Step 2.3: `update()` で settings → uniform を反映

`update()` メソッド内、`u.uLatticeN!.value = settings.lattice.resolution;` (481 行目あたり) の直後に追加。

```ts
    u.uLatticeN!.value = settings.lattice.resolution;
    u.uLatticeBaseShape!.value = settings.lattice.baseShape === "sphere" ? 1.0 : 0.0;
    u.uLatticeNoiseScale!.value = settings.lattice.noiseScale;
    u.uLatticeNoiseAmount!.value = settings.lattice.noiseAmount;
    u.uLatticeNoiseSeed!.value = settings.lattice.noiseSeed;
    u.uLatticeTwist!.value = settings.lattice.twist;
    u.uLatticeBend!.value = settings.lattice.bend;
    u.uLatticeTaper!.value = settings.lattice.taper;
    u.uLatticeRippleFreq!.value = settings.lattice.rippleFreq;
    u.uLatticeRippleAmp!.value = settings.lattice.rippleAmp;
```

### Step 2.4: lattice ブランチで `latticePos` を `shapePos` に rename

shader の lattice 分岐 (210-228 行目) を以下に差し替える (挙動は完全に同じ。後続タスクで `shapePos` に歪みを足せるようにするための準備)。

```glsl
    } else if (uMode < 3.5) {
      // lattice: NxNxN 厳密格子 + 形状歪み + bass shockwave (Issue #14, #41)
      int idx = int(aIndex + 0.5);
      int N = int(uLatticeN + 0.5);
      int N3 = N * N * N;
      if (idx >= N3) {
        pos = vec3(0.0);
        visAlpha = 0.0;
      } else {
        // WebGL1 互換のため整数 %% を使わず割り算で代用
        int ix = idx - (idx / N) * N;
        int iy = (idx / N) - (idx / (N * N)) * N;
        int iz = idx / (N * N);
        vec3 cell = vec3(float(ix), float(iy), float(iz));
        float cellSize = uShapeRadius * 2.0 / max(float(N - 1), 1.0);
        vec3 latticePos = (cell - vec3(float(N - 1) * 0.5)) * cellSize;

        // shapePos に対して順に: baseShape mapping → 軸変形 → ノイズ warp → ripple
        // (Issue #41 で段階的に追加。現在はまだ何もしない。)
        vec3 shapePos = latticePos;

        // shockwave 重畳 (中心は歪み後位置)
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
        pos += outwardDir * shimmer;
        visAlpha = 0.85;
      }
    } else {
```

### Step 2.5: テスト実行 + 視覚確認

```
cd /Users/shun/dev/three-art/.worktrees/41-lattice-distortion && bun run test 2>&1 | tail -5
```

期待: `305 pass / 0 fail` (Task 1 と同数)。

視覚: 後でブラウザで `bun run dev` 起動して lattice モードが従来通り動くことを確認 (挙動は変わらないはず)。今は plan 上で「変化なし」を確認しておけば OK。

### Step 2.6: コミット

```bash
git add src/pose-particles/visuals/PointCloud.ts
git commit -m "#41 refactor: lattice shader に歪み用 uniform を追加 + shapePos rename

- vertex shader に uLatticeBaseShape / uLatticeNoise* / uLatticeTwist /
  uLatticeBend / uLatticeTaper / uLatticeRipple* の 9 uniform を追加
- update() で settings.lattice の対応フィールドを反映
- lattice 分岐で latticePos -> shapePos に rename (挙動は同じ)。後続タスク
  で shapePos に baseShape mapping / 軸変形 / ノイズ / ripple を順次適用する
  足場とする

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: shader に 3D simplex noise 関数を追加

**目的:** Task 6 のノイズ warp で使う `snoise(vec3)` を shader utility として用意する。まだ使わない。

**Files:**
- Modify: `src/pose-particles/visuals/PointCloud.ts`

### Step 3.1: simplex noise 関数を追加

`PointCloud.ts` の vertex shader 内、`vec3 hash3unit(float seed) {` 関数 (99 行目あたり) の **直前** に Ashima Arts 3D simplex noise を追加。実装は public domain。

```glsl
  // ---- 3D simplex noise (Ashima Arts, public domain) -----------------------
  // 用途: lattice 形状歪み (Issue #41) の連続な position warp。ASCII-only。
  vec3 mod289_v3(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 mod289_v4(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 permute(vec4 x)   { return mod289_v4(((x * 34.0) + 1.0) * x); }
  vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

  float snoise(vec3 v) {
    const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i  = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g  = step(x0.yzx, x0.xyz);
    vec3 l  = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = mod289_v3(i);
    vec4 p = permute(permute(permute(
              i.z + vec4(0.0, i1.z, i2.z, 1.0))
            + i.y + vec4(0.0, i1.y, i2.y, 1.0))
            + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j  = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x  = x_ * ns.x + ns.yyyy;
    vec4 y  = y_ * ns.x + ns.yyyy;
    vec4 h  = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
  }
```

### Step 3.2: テスト実行

```
cd /Users/shun/dev/three-art/.worktrees/41-lattice-distortion && bun run test 2>&1 | tail -5
```

期待: `305 pass / 0 fail`。shader はまだ snoise を呼んでいないので挙動は変わらない (= regression なし)。

### Step 3.3: コミット

```bash
git add src/pose-particles/visuals/PointCloud.ts
git commit -m "#41 feat: shader に 3D simplex noise 関数を追加 (まだ未使用)

Ashima Arts の public domain 実装 snoise(vec3) を vertex shader に追加。
Task 6 のノイズ warp で使用する。ASCII-only / int uniform 不使用 (threejs-art
skill の罠回避)。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: baseShape (cube-to-sphere) mapping を shader に実装

**目的:** `lattice.baseShape === "sphere"` のとき、立方格子位置を球体ボリュームに変形する。

**Files:**
- Modify: `src/pose-particles/visuals/PointCloud.ts`

### Step 4.1: lattice 分岐に baseShape 変換を挿入

Task 2 で追加した `vec3 shapePos = latticePos;` の **直後** に以下を挿入。

```glsl
        vec3 shapePos = latticePos;
        if (uLatticeBaseShape > 0.5) {
          // cube-to-sphere mapping (Philip Nowell). [-uShapeRadius, +uShapeRadius]^3
          // を単位立方体に正規化 -> 球に押し込み -> 元のスケールへ戻す。
          float invR = 1.0 / max(uShapeRadius, 1e-5);
          vec3 n = latticePos * invR;            // [-1, 1]^3 に正規化
          vec3 n2 = n * n;
          vec3 mapped;
          mapped.x = n.x * sqrt(max(1.0 - n2.y * 0.5 - n2.z * 0.5 + n2.y * n2.z / 3.0, 0.0));
          mapped.y = n.y * sqrt(max(1.0 - n2.z * 0.5 - n2.x * 0.5 + n2.z * n2.x / 3.0, 0.0));
          mapped.z = n.z * sqrt(max(1.0 - n2.x * 0.5 - n2.y * 0.5 + n2.x * n2.y / 3.0, 0.0));
          shapePos = mapped * uShapeRadius;
        }
```

### Step 4.2: テスト実行

```
cd /Users/shun/dev/three-art/.worktrees/41-lattice-distortion && bun run test 2>&1 | tail -5
```

期待: `305 pass / 0 fail`。

### Step 4.3: 視覚確認 (手動)

```
cd /Users/shun/dev/three-art/.worktrees/41-lattice-distortion && bun run dev
```

ブラウザで:
1. mode を `lattice` に
2. `Mode > Lattice > baseShape` … は次タスクで追加するので、まずは localStorage を `Application > Storage > local` 経由で `lattice.baseShape = "sphere"` に書き換える、もしくは一時的に defaults を `baseShape: "sphere"` にして確認 (確認後に戻す)
3. 球体格子が見える → OK

**注意**: dropdown UI は Task 7 で追加するため、視覚確認は console から `window.__settings.lattice.baseShape = "sphere"` のような形になる。`__settings` グローバルが無い場合は本ステップを Task 7 後にスキップしてまとめて確認しても良い。

### Step 4.4: コミット

```bash
git add src/pose-particles/visuals/PointCloud.ts
git commit -m "#41 feat: lattice の baseShape='sphere' で cube-to-sphere mapping

uLatticeBaseShape == 1.0 のとき、NxNxN 立方格子位置を Philip Nowell の
cube-to-sphere 写像で球体ボリュームに変換する。粒子数は cube と同じ、
shockwave の radial 計算とも整合する。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: 軸変形 (twist → bend → taper) を shader に実装

**目的:** baseShape mapping の後ろに 3 段の幾何変形 (twist / bend / taper) を入れる。デフォルト値 (twist=0, bend=0, taper=1) で挙動が変わらないことを保証する。

**Files:**
- Modify: `src/pose-particles/visuals/PointCloud.ts`

### Step 5.1: baseShape ブロックの直後に軸変形を挿入

Task 4 で追加した `if (uLatticeBaseShape > 0.5) { ... }` の **直後** に以下を挿入。

```glsl
        // 軸変形 (twist y軸まわり -> bend y軸まわり -> taper y方向)
        // すべてデフォルト値 (twist=0, bend=0, taper=1) で恒等変換になる。
        if (uLatticeTwist != 0.0) {
          float a = uLatticeTwist * shapePos.y;
          float ca = cos(a);
          float sa = sin(a);
          shapePos.xz = mat2(ca, -sa, sa, ca) * shapePos.xz;
        }
        if (uLatticeBend != 0.0) {
          float a = uLatticeBend * shapePos.y;
          float ca = cos(a);
          float sa = sin(a);
          shapePos.xy = mat2(ca, -sa, sa, ca) * shapePos.xy;
        }
        if (uLatticeTaper != 1.0) {
          // y = +uShapeRadius で xz スケール = uLatticeTaper
          // y = -uShapeRadius で xz スケール = 1/uLatticeTaper
          float tInv = 1.0 / max(uLatticeTaper, 1e-3);
          float u = 0.5 + shapePos.y / (2.0 * uShapeRadius);
          float t = mix(tInv, uLatticeTaper, clamp(u, 0.0, 1.0));
          shapePos.xz *= t;
        }
```

### Step 5.2: テスト実行

```
cd /Users/shun/dev/three-art/.worktrees/41-lattice-distortion && bun run test 2>&1 | tail -5
```

期待: `305 pass / 0 fail`。

### Step 5.3: 視覚確認 (Task 7 後にまとめてもよい)

GUI が無いので Task 7 後に確認する想定でスキップ可。

### Step 5.4: コミット

```bash
git add src/pose-particles/visuals/PointCloud.ts
git commit -m "#41 feat: lattice に twist / bend / taper の軸変形を追加

shapePos に対して y 軸ねじり -> y 軸曲げ -> 上下スケール差の順に適用。
デフォルト値 (twist=0, bend=0, taper=1) で恒等変換となる。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: ノイズ warp と ripple を shader に実装

**目的:** 軸変形の後ろに「3D simplex ノイズによる位置 warp」と「sin 系 ripple」を入れる。両方とも振幅 0 で恒等変換。

**Files:**
- Modify: `src/pose-particles/visuals/PointCloud.ts`

### Step 6.1: ノイズ warp + ripple を軸変形の直後に挿入

Task 5 で追加した `if (uLatticeTaper != 1.0) { ... }` の **直後** に以下を挿入。

```glsl
        // ノイズ warp (3D simplex)。seed は origin offset として効かせる。
        if (uLatticeNoiseAmount > 0.0) {
          vec3 q = shapePos * uLatticeNoiseScale + vec3(uLatticeNoiseSeed * 17.3);
          vec3 offset = vec3(
            snoise(q),
            snoise(q + vec3(31.0, 0.0, 0.0)),
            snoise(q + vec3(0.0, 41.0, 0.0))
          );
          shapePos += offset * uLatticeNoiseAmount;
        }
        // ripple: 各軸が他軸の三角関数で揺らされる
        if (uLatticeRippleAmp > 0.0) {
          vec3 rq = shapePos * uLatticeRippleFreq;
          vec3 ripple = vec3(
            sin(rq.y) * cos(rq.z),
            sin(rq.z) * cos(rq.x),
            sin(rq.x) * cos(rq.y)
          );
          shapePos += ripple * uLatticeRippleAmp;
        }
```

### Step 6.2: テスト実行

```
cd /Users/shun/dev/three-art/.worktrees/41-lattice-distortion && bun run test 2>&1 | tail -5
```

期待: `305 pass / 0 fail`。

### Step 6.3: 視覚確認 (Task 7 後にまとめてもよい)

GUI が揃ってからの方が触りやすいのでスキップ可。

### Step 6.4: コミット

```bash
git add src/pose-particles/visuals/PointCloud.ts
git commit -m "#41 feat: lattice にノイズ warp と ripple を追加

軸変形後の shapePos に対して、3D simplex noise による連続な位置 warp と
sin 系 ripple を順に適用。noiseAmount == 0 / rippleAmp == 0 で恒等変換。
noiseSeed を origin offset として使い、整数 seed の違いで別形状が得られる。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: SettingsPanel に dropdown と Distortion サブフォルダを追加

**目的:** GUI から baseShape 切り替え + 8 個の歪みスライダを触れるようにする。

**Files:**
- Modify: `src/pose-particles/ui/SettingsPanel.ts`

### Step 7.1: Lattice フォルダに baseShape dropdown と Distortion サブフォルダを追加

`src/pose-particles/ui/SettingsPanel.ts` の Lattice ブロック (153-155 行目あたり) を以下に差し替える。

```ts
    const lattice = modeZone.addFolder("Lattice");
    lattice.add(settings.lattice, "baseShape", ["cube", "sphere"]).name("base shape");
    lattice.add(settings.lattice, "resolution", 8, 17, 1).name("resolution NxNxN");
    lattice.add(settings.lattice, "waveAmplitude", 0.0, 0.5, 0.005).name("wave amplitude (m)");

    const distortion = lattice.addFolder("Distortion (shape warp)");
    distortion.add(settings.lattice, "noiseScale", 0.1, 3.0, 0.01).name("noise scale (1/m)");
    distortion.add(settings.lattice, "noiseAmount", 0.0, 0.5, 0.005).name("noise amount (m)");
    distortion.add(settings.lattice, "noiseSeed", 1, 16, 1).name("noise seed");
    distortion.add(settings.lattice, "twist", -Math.PI, Math.PI, 0.01).name("twist (rad/m)");
    distortion.add(settings.lattice, "bend", -Math.PI / 4, Math.PI / 4, 0.005).name("bend (rad/m)");
    distortion.add(settings.lattice, "taper", 0.3, 1.7, 0.01).name("taper");
    distortion.add(settings.lattice, "rippleFreq", 0.5, 6.0, 0.05).name("ripple freq (1/m)");
    distortion.add(settings.lattice, "rippleAmp", 0.0, 0.3, 0.002).name("ripple amp (m)");
```

### Step 7.2: テスト実行

```
cd /Users/shun/dev/three-art/.worktrees/41-lattice-distortion && bun run test 2>&1 | tail -5
```

期待: `305 pass / 0 fail`。SettingsPanel.test.ts は GUI 構造の差分には敏感ではない (現状の構造で見ると個別 controller の存在を assert していない) ため、新コントローラ追加で落ちないはず。落ちたらエラーメッセージで該当 assertion を読み、必要なら test 側も追従する。

### Step 7.3: 視覚確認 (まとめて全機能)

```
cd /Users/shun/dev/three-art/.worktrees/41-lattice-distortion && bun run dev
```

確認項目:
1. mode = `lattice` で従来通りの cube 格子が表示される (全パラメータデフォルト)
2. `Mode > Lattice > base shape` を `sphere` に切替 → 球体格子になる
3. `Distortion > noise amount` を上げると粒子がうねって歪む
4. `Distortion > noise seed` を 1→2→3 と変えると別のうねり形になる
5. `Distortion > twist` でねじれが入る
6. `Distortion > bend` で y 方向に曲がる
7. `Distortion > taper` で上下のスケール差が出る
8. `Distortion > ripple amp` で凹凸が出る
9. bass のある曲を再生して shockwave が歪んだ形状の上で中心から外向きに伝播する
10. 他モード (bones / cube / sphere / image / rain) の見た目が変わっていない

### Step 7.4: コミット

```bash
git add src/pose-particles/ui/SettingsPanel.ts
git commit -m "#41 feat: SettingsPanel に baseShape dropdown と Distortion サブフォルダ追加

- Mode > Lattice の先頭に baseShape dropdown (cube/sphere) を配置
- Mode > Lattice > Distortion (shape warp) サブフォルダに 8 個のスライダ
  (noiseScale/Amount/Seed, twist/bend/taper, rippleFreq/Amp) を追加
- 値域は randomize.ts の RANDOMIZE_DESCRIPTORS と整合 (整数 step や clamping
  も含む)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: 最終回帰確認 + PR 作成

**目的:** 全機能の最終チェック、push、PR 作成。

### Step 8.1: 全テスト最終実行

```
cd /Users/shun/dev/three-art/.worktrees/41-lattice-distortion && bun run test 2>&1 | tail -10
```

期待: `305 pass / 0 fail`。

### Step 8.2: main との競合チェック (git.md の要求)

```bash
cd /Users/shun/dev/three-art/.worktrees/41-lattice-distortion
git fetch origin main
git merge-tree $(git merge-base HEAD origin/main) HEAD origin/main 2>&1 | tail -30
```

コンフリクトが出たら main を merge / rebase で取り込み、全テスト再実行。

### Step 8.3: push + PR 作成

```bash
git push -u origin feature/41-lattice-distortion
gh pr create --repo mishi5/three-art --base main --head feature/41-lattice-distortion \
  --title "#41 feat: lattice モードに baseShape + 形状歪みオプションを追加" \
  --body "$(cat <<'EOF'
Issue: https://github.com/mishi5/three-art/issues/41
spec: docs/superpowers/specs/2026-05-25-lattice-distortion-design.md
plan: docs/superpowers/plans/2026-05-25-lattice-distortion.md

## 変更内容

- LatticeSettings に baseShape (cube/sphere) と歪み系 8 パラメータ
  (noiseScale/Amount/Seed, twist/bend/taper, rippleFreq/Amp) を追加
- vertex shader に Ashima Arts 3D simplex noise を組み込み、lattice 分岐に
  baseShape mapping (cube-to-sphere) -> twist -> bend -> taper -> noise warp
  -> ripple -> shockwave 重畳 の順で適用
- SettingsPanel の Mode > Lattice に baseShape dropdown と Distortion
  サブフォルダ (8 スライダ) を追加
- MOTION_TARGETS / randomize / param-relevance / param-docs を整合させて drift
  検知テストを green に維持

## 動作確認

- 全テスト 305 pass / 0 fail
- デフォルト値で従来の lattice 挙動と完全一致
- baseShape=sphere / 歪み系パラメータの変更で形状が連続的に変わる
- shockwave は歪み後の形状の中心から外向きに伝播
- 他モード (bones/cube/sphere/image/rain) に regression なし

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

### Step 8.4: ユーザに確認依頼

PR URL を返した上で以下を提示。

```
動作確認:
cd /Users/shun/dev/three-art/.worktrees/41-lattice-distortion && bun run dev

PR: <作成された URL>
```

確認項目は Step 7.3 と同じ。

---

## 自己レビュー結果

- **spec カバレッジ**: spec の「やりたいこと」3 項目 (baseShape / 歪み 3 系統 / shockwave 併存) はそれぞれ Task 1/4 (baseShape), Task 1/5/6 (歪み), Task 2 の shapePos rename + Task 4-6 の shockwave 中心置換 (実は Task 2 の rename で既に shockwave は shapePos を使うように書き換わるため自動カバー) でカバー済み。
- **プレースホルダ**: なし。各 step に具体コード/コマンドあり。
- **型一貫性**: `LatticeBaseShape` 型は Task 1.3 で定義し、Task 2.3 で `settings.lattice.baseShape === "sphere"` で参照。フィールド名 (`noiseScale`/`noiseAmount`/`noiseSeed`/`twist`/`bend`/`taper`/`rippleFreq`/`rippleAmp`) は Task 1.3, 1.5, 1.6-1.8, 2.2, 2.3, 7.1 で同一綴りで一貫。
- **見落とし**: `param-docs.test.ts` の `every GUI parameter has a ParamDoc entry` は settings.leaf 全てに doc を要求するため Task 1.8 で 9 entries を入れる。`randomize.test.ts` の coverage 全 leaf チェックも Task 1.6 で対応。
