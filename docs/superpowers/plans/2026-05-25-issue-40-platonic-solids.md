# Issue #40: cube モードを正多面体 (4/6/8/12) から選択可能にする 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** pose-particles の cube モードを正四面体 / 正六面体 (現状) / 正八面体 / 正十二面体 から選択可能にし、SettingsPanel から切り替え + randomize 対象にする

**Spec:** `docs/superpowers/specs/2026-05-25-issue-40-platonic-solids-design.md`

**対象 Issue:** https://github.com/mishi5/three-art/issues/40

**Architecture:** `settings.shape.polyhedron: 4 | 6 | 8 | 12` 追加 (default 6 で後方互換)。PointCloud.ts の cube ブロックを 4 多面体分岐に書き換え、各多面体で外接球半径=1 の単位形状を返す sample 関数を vertex shader 上部に追加。`shape.radius` の semantics を「半辺長」から「外接球半径」に統一 (cube は √3 倍小さく見える)。randomize は新種別 `numEnum` を追加して数値リスト `[4,6,8,12]` から一様抽選。

**Tech Stack:** TypeScript, Three.js (WebGL1 互換), Bun test runner (`bun run test` = `bun test --isolate`)

**作業 worktree:** `/Users/shun/dev/three-art/.worktrees/40-platonic-solids`  
**ブランチ:** `feature/40-platonic-solids`

---

## File Structure

### 変更ファイル
- `src/pose-particles/settings.ts` - `PolyhedronFaces` 型と `Settings.shape.polyhedron` 追加
- `src/pose-particles/settings.test.ts` - default 値と localStorage migration テスト追加
- `src/pose-particles/ui/param-relevance.ts` - `shape.polyhedron` の relevance エントリ追加
- `src/pose-particles/ui/param-relevance.test.ts` - cube 専用挙動のテスト追加
- `src/pose-particles/ui/param-docs.ts` - `shape.polyhedron` の docs 追加 (param-docs.test.ts の網羅性テストで自動検証)
- `src/pose-particles/ui/randomize.ts` - `numEnum` 種別追加 + descriptor 追加
- `src/pose-particles/ui/randomize.test.ts` - cube/non-cube の descriptor 含有 + 値域テスト追加
- `src/pose-particles/visuals/PointCloud.ts` - uniform 追加 + cube ブロック多面体化 + sample 関数群追加

### 既存ファイル責務維持
全ファイルとも単一責務を維持。新規ファイル無し。

---

## Task 1: settings.ts に PolyhedronFaces 型と default 追加 (TDD)

**Files:**
- Modify: `src/pose-particles/settings.ts:10` 付近 (型エクスポート) と `src/pose-particles/settings.ts:201-206` (Settings.shape) と `355-359` (default)
- Test: `src/pose-particles/settings.test.ts` (末尾に追加)

- [ ] **Step 1: 失敗するテストを書く** — `src/pose-particles/settings.test.ts` の末尾 (`describe("ImageSettings defaults")` 群の近く) に追加:

```ts
describe("ShapeSettings polyhedron (Issue #40)", () => {
  test("makeDefaultSettings().shape.polyhedron === 6 (現状 cube の見た目互換)", () => {
    const s = makeDefaultSettings();
    expect(s.shape.polyhedron).toBe(6);
  });

  test("POLYHEDRON_FACES は 4/6/8/12 の 4 値", () => {
    expect(POLYHEDRON_FACES).toEqual([4, 6, 8, 12]);
  });
});
```

そして import 行に `POLYHEDRON_FACES` を足す:
```ts
import {
  RENDER_MODES,
  modeToInt,
  makeDefaultSettings,
  MOTION_TARGETS,
  POLYHEDRON_FACES,
} from "./settings";
```

- [ ] **Step 2: テスト失敗を確認**

Run: `cd /Users/shun/dev/three-art/.worktrees/40-platonic-solids && bun run test src/pose-particles/settings.test.ts 2>&1 | tail -20`  
Expected: 新規 2 テストが FAIL (`POLYHEDRON_FACES` が export されていない / `polyhedron` が default に無い)

- [ ] **Step 3: 型と default 追加** — `src/pose-particles/settings.ts` の `RenderMode` 定義近く (10 行目付近) に追加:

```ts
export type PolyhedronFaces = 4 | 6 | 8 | 12;
export const POLYHEDRON_FACES: ReadonlyArray<PolyhedronFaces> = [4, 6, 8, 12];
```

`Settings.shape` (201-206 行付近) を更新:
```ts
  shape: {
    /** 外接球半径 (中心 → 頂点距離) (m)。Issue #40 で cube モードも sphere と同じ「頂点距離」semantics に統一。 */
    radius: number;
    /** Bass-driven radial pulse strength. */
    bassPulse: number;
    /** cube モード時の正多面体面数 (4=tetra / 6=cube / 8=octa / 12=dodeca)。default 6。Issue #40。 */
    polyhedron: PolyhedronFaces;
  };
```

`makeDefaultSettings()` の `shape` ブロック (355-359 行付近) を更新:
```ts
    shape: {
      // ~0.4m fits comfortably in view at camera z=1.0, FOV 50°.
      radius: 0.4,
      bassPulse: 0.5,
      polyhedron: 6,
    },
```

- [ ] **Step 4: テスト PASS を確認**

Run: `cd /Users/shun/dev/three-art/.worktrees/40-platonic-solids && bun run test src/pose-particles/settings.test.ts 2>&1 | tail -10`  
Expected: 全 PASS

- [ ] **Step 5: 既存テストも全 PASS を確認** (型変更が他に波及していないか)

Run: `cd /Users/shun/dev/three-art/.worktrees/40-platonic-solids && bun run test 2>&1 | tail -5`  
Expected: `301 pass` 以上 (settings 拡張で param-docs.test.ts / param-relevance.test.ts が新 leaf を検出して FAIL するはず → 次タスクで解消)。具体的には:
- `param-relevance.test.ts` の「全 leaf が relevance に登録済み」テストが `shape.polyhedron` 未登録で FAIL
- `param-docs.test.ts` の「全 leaf に doc」テストが `shape.polyhedron` 未登録で FAIL  

これらは想定内なので次タスクで解消する (Step 6 ではコミットせず Task 2 と一緒に積む案もあるが、ここではコミットを分ける)。

- [ ] **Step 6: コミット**

```bash
cd /Users/shun/dev/three-art/.worktrees/40-platonic-solids
git add src/pose-particles/settings.ts src/pose-particles/settings.test.ts
git commit -m "$(cat <<'EOF'
#40 feat: settings.shape.polyhedron 追加 (default 6, type 4|6|8|12)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: param-relevance.ts に shape.polyhedron 登録 (TDD)

**Files:**
- Modify: `src/pose-particles/ui/param-relevance.ts:49` 付近 (shape 群)
- Test: `src/pose-particles/ui/param-relevance.test.ts` (末尾に追加)

- [ ] **Step 1: 失敗するテストを書く** — `src/pose-particles/ui/param-relevance.test.ts` の「代表挙動」describe 末尾に追加:

```ts
  test("shape.polyhedron は cube モードのみ活性 (Issue #40)", () => {
    expect(paramActiveForMode("shape.polyhedron", "cube")).toBe(true);
    for (const m of ["bones", "sphere", "lattice", "image", "rain"] as const) {
      expect(paramActiveForMode("shape.polyhedron", m)).toBe(false);
    }
  });
```

- [ ] **Step 2: テスト失敗を確認**

Run: `cd /Users/shun/dev/three-art/.worktrees/40-platonic-solids && bun run test src/pose-particles/ui/param-relevance.test.ts 2>&1 | tail -20`  
Expected: 新規テストが FAIL (`paramActiveForMode("shape.polyhedron", "bones")` が未登録で fail-open の true を返す)、加えて完全性テスト (`relevance マップに余分な (settings に無い) パスが無い` の逆: 「全 leaf が登録」) が FAIL

- [ ] **Step 3: relevance エントリ追加** — `src/pose-particles/ui/param-relevance.ts:49-50` の `shape.*` 行近くに追加:

```ts
  // bones では PointCloud 内未使用だが EdgeOverlay で参照されるため実効。
  "shape.radius": new Set(PARTICLE),
  "shape.bassPulse": new Set(PARTICLE),
  "shape.polyhedron": new Set(["cube" as const]),
```

(TypeScript の型推論で `Set<"cube">` になると `Set<RenderMode>` に代入できないため `as const` を付ける。既存の `new Set(["bones"])` パターンと整合)

- [ ] **Step 4: テスト PASS を確認**

Run: `cd /Users/shun/dev/three-art/.worktrees/40-platonic-solids && bun run test src/pose-particles/ui/param-relevance.test.ts 2>&1 | tail -10`  
Expected: 全 PASS (新規 1 件 + 完全性テスト含む)

- [ ] **Step 5: コミット**

```bash
cd /Users/shun/dev/three-art/.worktrees/40-platonic-solids
git add src/pose-particles/ui/param-relevance.ts src/pose-particles/ui/param-relevance.test.ts
git commit -m "$(cat <<'EOF'
#40 feat: shape.polyhedron を param-relevance に登録 (cube モード専用)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: param-docs.ts に shape.polyhedron の説明追加

**Files:**
- Modify: `src/pose-particles/ui/param-docs.ts:139-146` 付近 (shape セクション)

- [ ] **Step 1: 現状のテスト失敗を確認 (Task 1 から積み残し)**

Run: `cd /Users/shun/dev/three-art/.worktrees/40-platonic-solids && bun run test src/pose-particles/ui/param-docs.test.ts 2>&1 | tail -10`  
Expected: 「every GUI parameter has a ParamDoc entry」が FAIL (`shape.polyhedron` の doc 不在)

- [ ] **Step 2: doc 追加** — `src/pose-particles/ui/param-docs.ts` の `"shape.bassPulse"` エントリの直後に追加:

```ts
  "shape.polyhedron": {
    summary: "cube モードの正多面体面数 (4=正四面体 / 6=正六面体 / 8=正八面体 / 12=正十二面体)。",
    effect: "面数を変えると粒子表面の形状が切り替わる。cube モード以外では効果なし。",
  },
```

- [ ] **Step 3: テスト PASS を確認**

Run: `cd /Users/shun/dev/three-art/.worktrees/40-platonic-solids && bun run test src/pose-particles/ui/param-docs.test.ts 2>&1 | tail -10`  
Expected: 全 PASS

- [ ] **Step 4: コミット**

```bash
cd /Users/shun/dev/three-art/.worktrees/40-platonic-solids
git add src/pose-particles/ui/param-docs.ts
git commit -m "$(cat <<'EOF'
#40 docs: shape.polyhedron の param-docs エントリ追加

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: randomize.ts に numEnum 種別追加 + shape.polyhedron descriptor 追加 (TDD)

**Files:**
- Modify: `src/pose-particles/ui/randomize.ts:16-19` (RandSpec 型), `42-62` (helper 関数), `64-125` (descriptors), `189-210` (randomizeSettings)
- Test: `src/pose-particles/ui/randomize.test.ts` の cube/sphere ケース (112 行付近) + 新規 describe 追加

- [ ] **Step 1: 失敗するテストを書く** — `randomize.test.ts:112` の「cube/sphere modes include shape and edges...」ケースに以下を追加:

cube ケースだけ別 it に分割するため、112 行付近の `it("cube/sphere modes include shape and edges...")` の直後に追加:

```ts
  it("cube mode includes shape.polyhedron (Issue #40), other modes exclude it", () => {
    expect(paths("cube")).toContain("shape.polyhedron");
    for (const m of ["bones", "sphere", "lattice", "image", "rain"] as const) {
      expect(paths(m)).not.toContain("shape.polyhedron");
    }
  });
```

`describe("randomizeSettings")` 末尾に動作テスト追加:

```ts
  it("randomizes shape.polyhedron to one of [4,6,8,12] when mode=cube (Issue #40)", () => {
    const base = makeDefaultSettings();
    let rngCalls = 0;
    const rng = () => {
      // 段階的に異なる値を返して複数結果を観測
      rngCalls++;
      return ((rngCalls * 0.137) % 1.0);
    };
    const out = randomizeSettings(base, "cube", rng);
    expect([4, 6, 8, 12]).toContain(out.shape.polyhedron);
    expect(typeof out.shape.polyhedron).toBe("number");
  });

  it("does not change shape.polyhedron when mode=bones (Issue #40)", () => {
    const base = makeDefaultSettings();
    base.shape.polyhedron = 8;
    const out = randomizeSettings(base, "bones", () => 0.99);
    expect(out.shape.polyhedron).toBe(8);
  });
```

(`makeDefaultSettings` / `randomizeSettings` は既存 import から拾えるはず。`paths` helper はファイル冒頭にある。)

- [ ] **Step 2: テスト失敗を確認**

Run: `cd /Users/shun/dev/three-art/.worktrees/40-platonic-solids && bun run test src/pose-particles/ui/randomize.test.ts 2>&1 | tail -25`  
Expected: 新規 3 テストすべて FAIL (`shape.polyhedron` が descriptor リスト未登録 / 値変更されず default 6 のまま)

- [ ] **Step 3: RandSpec に numEnum 種別追加** — `src/pose-particles/ui/randomize.ts:16-19`:

```ts
export type RandSpec =
  | { path: string; kind: "number"; min: number; max: number; step: number }
  | { path: string; kind: "boolean" }
  | { path: string; kind: "enum"; options: ReadonlyArray<string> }
  | { path: string; kind: "numEnum"; options: ReadonlyArray<number> };
```

helper 関数追加 (`enm` の直後、62 行付近):

```ts
function numEnm(
  path: string,
  options: ReadonlyArray<number>,
  modes: ReadonlyArray<RenderMode>,
): ParamDescriptor {
  return { spec: { path, kind: "numEnum", options }, modes };
}
```

- [ ] **Step 4: cube 専用 mode group + descriptor 追加** — `src/pose-particles/ui/randomize.ts:42` 付近の mode group エリアに追加:

```ts
const CUBE: ReadonlyArray<RenderMode> = ["cube"];
```

shape セクション (124-125 行付近) の末尾に descriptor を追加:

```ts
  // --- shape.* (bones/cube/sphere/lattice; Issue #37 で bones/lattice まで拡張) ---
  num("shape.radius", 0.1, 3, 0.05, SHAPE_MODES),
  num("shape.bassPulse", 0, 3, 0.05, SHAPE_MODES),
  // --- shape.polyhedron (cube 専用; Issue #40) ---
  numEnm("shape.polyhedron", [4, 6, 8, 12], CUBE),
```

- [ ] **Step 5: randomizeSettings の switch に numEnum 分岐追加** — `src/pose-particles/ui/randomize.ts:196-206` のループを変更:

```ts
  for (const { spec } of descriptorsForMode(mode)) {
    let value: unknown;
    if (spec.kind === "number") {
      value = steppedNumber(spec, rng);
    } else if (spec.kind === "boolean") {
      value = rng() < 0.5;
    } else if (spec.kind === "numEnum") {
      const idx = Math.min(spec.options.length - 1, Math.floor(rng() * spec.options.length));
      value = spec.options[idx];
    } else {
      // enum (string)
      const idx = Math.min(spec.options.length - 1, Math.floor(rng() * spec.options.length));
      value = spec.options[idx];
    }
    setByPath(target, spec.path, value);
  }
```

- [ ] **Step 6: テスト PASS を確認**

Run: `cd /Users/shun/dev/three-art/.worktrees/40-platonic-solids && bun run test src/pose-particles/ui/randomize.test.ts 2>&1 | tail -15`  
Expected: 全 PASS

- [ ] **Step 7: 全テスト PASS を確認**

Run: `cd /Users/shun/dev/three-art/.worktrees/40-platonic-solids && bun run test 2>&1 | tail -5`  
Expected: `pass` 数が増加、`fail` 0 件

- [ ] **Step 8: コミット**

```bash
cd /Users/shun/dev/three-art/.worktrees/40-platonic-solids
git add src/pose-particles/ui/randomize.ts src/pose-particles/ui/randomize.test.ts
git commit -m "$(cat <<'EOF'
#40 feat: randomize に numEnum 種別と shape.polyhedron descriptor 追加 (cube 専用)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: PointCloud.ts に uPolyhedron uniform 追加 (型ハンドル)

**Files:**
- Modify: `src/pose-particles/visuals/PointCloud.ts:29` 付近 (uniform 宣言), `:407` 付近 (default 値), `:480` 付近 (update での代入)

このタスクは shader 内ロジックを変えないので動作は変わらない (uniform を追加するだけ)。テストはない (WebGL 範囲外)。コンパイル通過と既存テスト全 PASS を確認。

- [ ] **Step 1: GLSL uniform 宣言追加** — `src/pose-particles/visuals/PointCloud.ts:29` (uMode の直下) に追加:

```glsl
  uniform float uMode;          // 0=bones, 1=cube, 2=sphere, 3=lattice, 4=image (float for WebGL1 portability)
  uniform float uPolyhedron;    // 4 | 6 | 8 | 12 (cube モード時の正多面体面数。Issue #40)
  uniform float uLatticeN;      // 格子解像度 (lattice モードのみ使用)
```

- [ ] **Step 2: JS 側 default 値追加** — `src/pose-particles/visuals/PointCloud.ts:407` (`uMode: { value: 0.0 }` の直下) に追加:

```ts
        uMode: { value: 0.0 },
        uPolyhedron: { value: 6.0 },
        uLatticeN: { value: 12.0 },
```

- [ ] **Step 3: update() で settings から代入** — `src/pose-particles/visuals/PointCloud.ts:480` (`u.uMode!.value = modeToInt(settings.mode);` の直下) に追加:

```ts
    u.uMode!.value = modeToInt(settings.mode);
    u.uPolyhedron!.value = settings.shape.polyhedron;
    u.uLatticeN!.value = settings.lattice.resolution;
```

- [ ] **Step 4: 型チェック (型エラーないか確認)**

Run: `cd /Users/shun/dev/three-art/.worktrees/40-platonic-solids && bun run check 2>&1 | tail -15` (もし `check` script が無ければ `bun x tsc --noEmit -p tsconfig.json 2>&1 | tail -15`)  
Expected: 型エラーなし

- [ ] **Step 5: 全テスト PASS を確認**

Run: `cd /Users/shun/dev/three-art/.worktrees/40-platonic-solids && bun run test 2>&1 | tail -5`  
Expected: 全 PASS

- [ ] **Step 6: コミット**

```bash
cd /Users/shun/dev/three-art/.worktrees/40-platonic-solids
git add src/pose-particles/visuals/PointCloud.ts
git commit -m "$(cat <<'EOF'
#40 feat: PointCloud に uPolyhedron uniform 追加 (まだ shader 内未使用)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: PointCloud.ts に sample 関数群追加 + cube ブロック多面体化 + radius semantics 統一

このタスクが本実装の核。shader 内に 4 つの sample 関数を追加し、cube ブロックを多面体分岐に書き換える。

**Files:**
- Modify: `src/pose-particles/visuals/PointCloud.ts:137-186` 付近

### サンプリング理論まとめ
- **三角形重心一様サンプリング**: `vec3 sampleTri(vec3 A, vec3 B, vec3 C, vec2 r)`: `float s = sqrt(r.x); return (1.0 - s)*A + s*(1.0 - r.y)*B + s*r.y*C;`
- **Tetrahedron**: 4 頂点 `(±1,±1,±1)` のうち偶数個マイナスを 1/√3 で正規化 (外接球半径 1)。4 面三角形を faceHash で 1/4 ずつ抽選
- **Cube**: 既存 6 面を 1/√3 で正規化 (頂点距離 √3 → 1)
- **Octahedron**: 軸頂点 `(±1,0,0),(0,±1,0),(0,0,±1)` (既に外接球半径 1)。8 octant の 3 頂点で重心サンプリング
- **Dodecahedron**: 12 面の中心法線 = 正二十面体の 12 頂点を 1/√(2+φ) で正規化したもの。各面で center=normal·r_in、orthonormal basis を法線から構成、pentagon 5 頂点を角度 0°,72°,144°,216°,288° で再構成、fan 5 三角形のうち 1 つを r.z で抽選してその三角形で重心サンプリング
  - 定数: `r_in/R = 0.79465447 (inradius/circumradius)`, `rho_pent/R = 0.60706548 (pentagon center→vertex)`

- [ ] **Step 1: sample 関数群を vertex shader 上部に追加** — `src/pose-particles/visuals/PointCloud.ts:122` (`selectVisibility` 関数の直後、`void main()` の直前) に追加:

```glsl
  // ---- 正多面体サンプリング (Issue #40) ----
  // 全関数は外接球半径 1 の単位多面体上の点を返す。
  // caller 側で uShapeRadius を掛けて scale する。

  vec3 sampleTri(vec3 A, vec3 B, vec3 C, vec2 r) {
    float s = sqrt(r.x);
    return (1.0 - s) * A + s * (1.0 - r.y) * B + s * r.y * C;
  }

  vec3 sampleTetrahedron(float faceHash, vec2 r) {
    // 頂点 (1,1,1) / sqrt(3), (1,-1,-1) / sqrt(3), (-1,1,-1) / sqrt(3), (-1,-1,1) / sqrt(3)
    float inv = 1.0 / sqrt(3.0);
    vec3 v0 = vec3( 1.0,  1.0,  1.0) * inv;
    vec3 v1 = vec3( 1.0, -1.0, -1.0) * inv;
    vec3 v2 = vec3(-1.0,  1.0, -1.0) * inv;
    vec3 v3 = vec3(-1.0, -1.0,  1.0) * inv;
    if      (faceHash < 0.25) return sampleTri(v0, v1, v2, r);
    else if (faceHash < 0.50) return sampleTri(v0, v2, v3, r);
    else if (faceHash < 0.75) return sampleTri(v0, v3, v1, r);
    else                      return sampleTri(v1, v3, v2, r);
  }

  vec3 sampleCube(float faceHash, vec2 r) {
    // 既存ロジックを 1/sqrt(3) で正規化 (外接球半径 1)
    vec2 uv = (r - 0.5) * 2.0;
    vec3 p;
    if      (faceHash < 0.16667) p = vec3( 1.0, uv.x, uv.y);
    else if (faceHash < 0.33333) p = vec3(-1.0, uv.x, uv.y);
    else if (faceHash < 0.50000) p = vec3(uv.x,  1.0, uv.y);
    else if (faceHash < 0.66667) p = vec3(uv.x, -1.0, uv.y);
    else if (faceHash < 0.83333) p = vec3(uv.x, uv.y,  1.0);
    else                         p = vec3(uv.x, uv.y, -1.0);
    return p / sqrt(3.0);
  }

  vec3 sampleOctahedron(float faceHash, vec2 r) {
    // 6 頂点はすでに外接球半径 1
    vec3 px = vec3( 1.0,  0.0,  0.0);
    vec3 nx = vec3(-1.0,  0.0,  0.0);
    vec3 py = vec3( 0.0,  1.0,  0.0);
    vec3 ny = vec3( 0.0, -1.0,  0.0);
    vec3 pz = vec3( 0.0,  0.0,  1.0);
    vec3 nz = vec3( 0.0,  0.0, -1.0);
    // 8 octant の三角形 (+++ +-+ +-- ++- -++ --+ --- -+-)
    if      (faceHash < 0.125) return sampleTri(px, py, pz, r);
    else if (faceHash < 0.250) return sampleTri(px, pz, ny, r);
    else if (faceHash < 0.375) return sampleTri(px, ny, nz, r);
    else if (faceHash < 0.500) return sampleTri(px, nz, py, r);
    else if (faceHash < 0.625) return sampleTri(nx, pz, py, r);
    else if (faceHash < 0.750) return sampleTri(nx, ny, pz, r);
    else if (faceHash < 0.875) return sampleTri(nx, nz, ny, r);
    else                       return sampleTri(nx, py, nz, r);
  }

  vec3 dodecaFaceNormal(int i) {
    // 12 面の単位法線 (= 正二十面体頂点を 1/sqrt(2+phi) で正規化)
    // phi = (1+sqrt(5))/2 ≈ 1.61803, 1/sqrt(2+phi) ≈ 0.52573, phi/sqrt(2+phi) ≈ 0.85065
    if (i == 0)  return vec3(0.0,  0.52573,  0.85065);
    if (i == 1)  return vec3(0.0,  0.52573, -0.85065);
    if (i == 2)  return vec3(0.0, -0.52573,  0.85065);
    if (i == 3)  return vec3(0.0, -0.52573, -0.85065);
    if (i == 4)  return vec3( 0.52573,  0.85065, 0.0);
    if (i == 5)  return vec3( 0.52573, -0.85065, 0.0);
    if (i == 6)  return vec3(-0.52573,  0.85065, 0.0);
    if (i == 7)  return vec3(-0.52573, -0.85065, 0.0);
    if (i == 8)  return vec3( 0.85065, 0.0,  0.52573);
    if (i == 9)  return vec3( 0.85065, 0.0, -0.52573);
    if (i == 10) return vec3(-0.85065, 0.0,  0.52573);
    return            vec3(-0.85065, 0.0, -0.52573);  // i == 11
  }

  vec3 sampleDodecahedron(float faceHash, vec3 r) {
    // faceHash で 12 面選択、r.z で 5 fan 三角形選択、r.xy で重心サンプリング
    int faceIdx = int(floor(faceHash * 12.0));
    if (faceIdx > 11) faceIdx = 11;
    vec3 n = dodecaFaceNormal(faceIdx);

    // 面平面の orthonormal basis (法線から構成、向きの一意性は不要 = 重心サンプリングは回転対称)
    vec3 helper = abs(n.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    vec3 u = normalize(cross(helper, n));
    vec3 v = cross(n, u);

    // 面の幾何
    float rIn  = 0.79465447;   // 単位 dodecahedron の inradius (中心 → 面)
    float rho  = 0.60706548;   // 面中心 → pentagon 頂点 (face plane 上)
    vec3 center = n * rIn;

    // 5 fan 三角形 (center, ringK, ringK+1) のうち 1 つを選択
    int k = int(floor(r.z * 5.0));
    if (k > 4) k = 4;
    float twoPi = 6.2831853;
    float a0 = float(k) * (twoPi / 5.0);
    float a1 = float(k + 1) * (twoPi / 5.0);
    vec3 vert0 = center + rho * (cos(a0) * u + sin(a0) * v);
    vec3 vert1 = center + rho * (cos(a1) * u + sin(a1) * v);
    return sampleTri(center, vert0, vert1, r.xy);
  }
```

- [ ] **Step 2: cube ブロックを多面体分岐に書き換え** — `src/pose-particles/visuals/PointCloud.ts:170-186` の `else if (uMode < 1.5) { ... }` ブロックを置換:

```glsl
    } else if (uMode < 1.5) {
      // cube モード: 正多面体表面サンプリング (uPolyhedron で 4|6|8|12 切替)。Issue #40。
      // sample 関数は外接球半径 1 の単位多面体上の点を返す。
      // shape.radius は「中心 → 頂点」距離 (外接球半径) として統一 (Issue #40)。
      float faceHash = fract(aSeed * 13.717 + aJointIndex * 0.41);
      vec3 r = hash3unit(aSeed * 7.0 + aJointIndex + 1.0);
      vec3 unit;
      if (uPolyhedron < 5.0) {
        unit = sampleTetrahedron(faceHash, r.xy);
      } else if (uPolyhedron < 7.0) {
        unit = sampleCube(faceHash, r.xy);
      } else if (uPolyhedron < 10.0) {
        unit = sampleOctahedron(faceHash, r.xy);
      } else {
        unit = sampleDodecahedron(faceHash, r);
      }
      float scale = uShapeRadius * (1.0 + uBass * uShapeBassPulse) * outlier;
      pos = unit * scale + normalize(unit + 0.0001) * shimmer;
      visAlpha = 0.85;
    } else if (uMode < 2.5) {
```

- [ ] **Step 3: 全テスト PASS を確認 (shader はテストされないが、TypeScript 型・既存テストが壊れていないか)**

Run: `cd /Users/shun/dev/three-art/.worktrees/40-platonic-solids && bun run test 2>&1 | tail -5`  
Expected: 全 PASS

- [ ] **Step 4: 型チェック**

Run: `cd /Users/shun/dev/three-art/.worktrees/40-platonic-solids && bun run check 2>&1 | tail -5` (なければ `bun x tsc --noEmit 2>&1 | tail -5`)  
Expected: 型エラーなし

- [ ] **Step 5: 開発サーバ起動して手動 GLSL コンパイル確認 (ブラウザ DevTools console で WebGL エラーが出ないか)** — このステップはユーザ側の動作確認時にまとめて行うので、ここではコード変更のみ。

- [ ] **Step 6: コミット**

```bash
cd /Users/shun/dev/three-art/.worktrees/40-platonic-solids
git add src/pose-particles/visuals/PointCloud.ts
git commit -m "$(cat <<'EOF'
#40 feat: PointCloud cube ブロックを正多面体 (4/6/8/12) 分岐化

- sampleTetrahedron / sampleCube / sampleOctahedron / sampleDodecahedron 追加
- shape.radius semantics を「外接球半径 (頂点距離)」に統一
  (cube は同 radius 値で √3 倍小さく見える)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: SettingsPanel.ts に polyhedron セレクタ追加

**Files:**
- Modify: `src/pose-particles/ui/SettingsPanel.ts:142` 付近 (Shape フォルダ)

- [ ] **Step 1: セレクタ追加** — `src/pose-particles/ui/SettingsPanel.ts:142-144` の Shape フォルダブロックを更新:

```ts
    const shape = modeZone.addFolder("Shape (cube / sphere)");
    shape.add(settings.shape, "polyhedron", {
      "4 (tetrahedron)": 4,
      "6 (cube)": 6,
      "8 (octahedron)": 8,
      "12 (dodecahedron)": 12,
    }).name("polyhedron faces");
    shape.add(settings.shape, "radius", 0.1, 3, 0.05).name("radius / half-size");
    shape.add(settings.shape, "bassPulse", 0, 3, 0.05).name("bass pulse");
```

- [ ] **Step 2: 全テスト PASS を確認**

Run: `cd /Users/shun/dev/three-art/.worktrees/40-platonic-solids && bun run test 2>&1 | tail -5`  
Expected: 全 PASS (SettingsPanel.test.ts が壊れていない)

- [ ] **Step 3: コミット**

```bash
cd /Users/shun/dev/three-art/.worktrees/40-platonic-solids
git add src/pose-particles/ui/SettingsPanel.ts
git commit -m "$(cat <<'EOF'
#40 feat: SettingsPanel に polyhedron セレクタ追加 (Shape フォルダ)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: 全テスト + 型チェック + ブラウザ動作確認

- [ ] **Step 1: 全テスト**

Run: `cd /Users/shun/dev/three-art/.worktrees/40-platonic-solids && bun run test 2>&1 | tail -5`  
Expected: 全件 PASS

- [ ] **Step 2: 型チェック**

Run: `cd /Users/shun/dev/three-art/.worktrees/40-platonic-solids && bun run check 2>&1 | tail -5` (なければ `bun x tsc --noEmit 2>&1 | tail -5`)  
Expected: 型エラーなし

- [ ] **Step 3: ブラウザで動作確認** — Claude が自動で起動して確認できない場合、ユーザに依頼する手前で以下を AI 側で軽くだけ起動チェック:

Run (背景起動): `cd /Users/shun/dev/three-art/.worktrees/40-platonic-solids && bun run dev:pose-particles`  
(または `bun run dev` でルート URL から手動選択)

DevTools console で WebGL shader compile エラーが出ていないことを確認。

---

## Task 9: PR 作成

- [ ] **Step 1: ブランチを push**

```bash
cd /Users/shun/dev/three-art/.worktrees/40-platonic-solids
git push -u origin feature/40-platonic-solids
```

- [ ] **Step 2: PR 作成 (`Closes #40` は書かない)**

```bash
cd /Users/shun/dev/three-art/.worktrees/40-platonic-solids
gh pr create --title "#40 feature: cube モードを正多面体 (4/6/8/12) から選択可能に" --body "$(cat <<'EOF'
## Summary
- pose-particles の cube モードで `shape.polyhedron` (4=正四面体 / 6=正六面体 / 8=正八面体 / 12=正十二面体) を選択可能に
- SettingsPanel の Shape フォルダにセレクタを追加、randomize は cube モード時に `[4,6,8,12]` から一様抽選
- `shape.radius` の semantics を「外接球半径 (頂点距離)」に統一 (cube は同 radius 値で √3 倍小さく見える)

## 対象 Issue
https://github.com/mishi5/three-art/issues/40

## 設計ドキュメント
- spec: `docs/superpowers/specs/2026-05-25-issue-40-platonic-solids-design.md`
- plan: `docs/superpowers/plans/2026-05-25-issue-40-platonic-solids.md`

## Test plan
- [ ] `bun run test` 全件 PASS
- [ ] 型チェック PASS
- [ ] cube + polyhedron=4 で正四面体の表面に粒子が分布
- [ ] cube + polyhedron=6 で従来通り立方体表面 (見た目は √3 倍小さくなる)
- [ ] cube + polyhedron=8 で正八面体表面
- [ ] cube + polyhedron=12 で正十二面体表面
- [ ] bass で各形状が pulse する / shimmer が乗る
- [ ] randomize ボタンで polyhedron 値が変わる (cube モード時)
- [ ] cube 以外のモード (bones/sphere/lattice/image/rain) では shape.polyhedron が disable 表示

## 後方互換
- localStorage 既存 snapshot は `polyhedron: 6` で自動補完 (deepMerge)
- `shape.radius` semantics 変更により cube が同値で √3 倍小さく見えるが、設定値は保持される
EOF
)"
```

---

## Task 10: main コンフリクトチェック

- [ ] **Step 1: 最新 main を取得**

```bash
cd /Users/shun/dev/three-art/.worktrees/40-platonic-solids
git fetch origin main
```

- [ ] **Step 2: main へのマージ可能性を確認**

```bash
cd /Users/shun/dev/three-art/.worktrees/40-platonic-solids
git merge-tree $(git merge-base HEAD origin/main) HEAD origin/main 2>&1 | head -40
```

コンフリクトが無ければ次へ。コンフリクトがあれば:
1. `git rebase origin/main` でコンフリクト解消
2. 全テスト再実行 (`bun run test`)
3. `git push --force-with-lease`

- [ ] **Step 3: ユーザに動作確認依頼**

ユーザに以下メッセージで動作確認を依頼:

> 動作確認お願いします。以下 1 行で起動できます:
>
> ```bash
> cd /Users/shun/dev/three-art/.worktrees/40-platonic-solids && bun run dev
> ```
>
> 確認ポイント:
> - cube モードで polyhedron を 4/6/8/12 切替してそれぞれの表面に粒子が分布
> - cube + polyhedron=6 で従来より √3 倍小さく見える (radius=0.4 default)
> - bass pulse / shimmer / outlier が機能
> - randomize で polyhedron が変わる (cube モード時のみ)
> - 他モードでは shape.polyhedron が disable 表示

---

## Task 11: マージ後処理

ユーザの確認 OK を得てから実施。

- [ ] **Step 1: PR マージ**

```bash
gh pr merge --squash --delete-branch
```

- [ ] **Step 2: Issue に対応内容コメント + クローズ**

```bash
gh issue comment 40 --repo mishi5/three-art --body "$(cat <<'EOF'
## 対応内容
- `src/pose-particles/settings.ts`: `PolyhedronFaces` 型 + `shape.polyhedron` 追加 (default 6)
- `src/pose-particles/visuals/PointCloud.ts`: cube ブロックを 4 多面体分岐に書き換え + sample 関数 (sampleTetrahedron / sampleCube / sampleOctahedron / sampleDodecahedron) 追加。`shape.radius` を外接球半径 semantics に統一
- `src/pose-particles/ui/SettingsPanel.ts`: polyhedron セレクタ追加
- `src/pose-particles/ui/param-relevance.ts`: `shape.polyhedron` を cube 専用として登録
- `src/pose-particles/ui/randomize.ts`: `numEnum` 種別追加 + `shape.polyhedron` を cube 専用 randomize 対象に
- `src/pose-particles/ui/param-docs.ts`: docs エントリ追加
- 各種テスト追加

## 後方互換に関する注意
`shape.radius` の semantics が「半辺長」から「外接球半径 (頂点距離)」に変更されたため、cube モードは同じ radius 値で従来より √3 ≒ 1.73 倍小さく見えるようになります (sphere とスケールが揃う)。

PR: #<PR番号>
EOF
)"
gh issue close 40 --repo mishi5/three-art
```

- [ ] **Step 3: 後片付け**

```bash
cd /Users/shun/dev/three-art
git worktree remove .worktrees/40-platonic-solids
git branch -D feature/40-platonic-solids
git pull origin main
```

---

## Self-Review チェック

### Spec coverage
| Spec 要件 | 対応 Task |
| --- | --- |
| `PolyhedronFaces` 型 + `shape.polyhedron` 追加 | Task 1 |
| default 6 で後方互換 | Task 1 (default + deepMerge は既存挙動) |
| `uPolyhedron` uniform 追加 | Task 5 |
| 外接球半径 semantics 統一 | Task 6 (sample 関数群 + cube ブロック) |
| `sampleTetrahedron` / `sampleCube` / `sampleOctahedron` / `sampleDodecahedron` | Task 6 |
| WebGL1 互換 (cascaded if/else) | Task 6 (動的 uniform 配列 index なし) |
| SettingsPanel セレクタ | Task 7 |
| relevance 登録 (cube 専用) | Task 2 |
| randomize 対象 (cube 専用) | Task 4 (`numEnum` 種別追加) |
| param-docs エントリ | Task 3 |
| 既存テスト整合 | Task 1-7 各 Step で全テスト確認 |

すべての spec 要件が対応 Task にマッピングされている。

### Placeholder scan
- "TBD" / "TODO" / "implement later" 無し
- 全コードブロックに実コード記載
- 全コマンドに具体パス + 期待出力

### Type consistency
- `PolyhedronFaces` = `4 | 6 | 8 | 12` で全タスク一貫
- `settings.shape.polyhedron` パスで全箇所参照
- `numEnum` の `options: ReadonlyArray<number>` で全箇所一貫
