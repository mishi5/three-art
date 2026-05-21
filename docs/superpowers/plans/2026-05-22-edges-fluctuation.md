# Edges 揺らぎ実装プラン (Issue #31)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Issue:** https://github.com/mishi5/three-art/issues/31

**Goal:** `EdgeOverlay` のラインに 2 種類の揺らぎ (Perlin ノイズ + 音量連動の波打ち、一定間隔でのリワイヤ + クロスフェード) を追加し、GUI から制御できるようにする。

**Architecture:** 既存の `LineSegments` を分割数 S で細分化したサブセグメント列に拡張する。`wave.enabled = false` かつ `rewire.enabled = false` の場合は分割を行わず、現状の挙動と完全に一致する fast path を残す。波打ちは CPU で 3D value noise を評価し、エッジ毎の局所座標系 (接線/法線/従法線) で内部頂点をオフセット。リワイヤは「論理エッジ」をスケジュールキューで管理し、フェード中の不透明度を頂点カラー RGB (加法ブレンド下で輝度=実効 alpha) に書き込む。

**Tech Stack:** TypeScript, Three.js (LineSegments + BufferGeometry + LineBasicMaterial with vertexColors), Bun test, lil-gui.

---

## File Structure

- **Create** `src/pose-particles/visuals/value-noise.ts` — 決定論的 3D value noise (`noise3D(x, y, z) → [-1, 1]`)
- **Create** `src/pose-particles/visuals/value-noise.test.ts` — value noise の値域/連続性テスト
- **Modify** `src/pose-particles/settings.ts` — `EdgesWaveSettings` / `EdgesRewireSettings` 追加、defaults
- **Modify** `src/pose-particles/visuals/EdgeOverlay.ts` — 細分化 + 波打ち + リワイヤ + フェード
- **Modify** `src/pose-particles/visuals/EdgeOverlay.test.ts` — 新機能のテストを追記
- **Modify** `src/pose-particles/ui/param-docs.ts` — 新パラメータの doc 追加
- **Modify** `src/pose-particles/ui/param-relevance.ts` — 新パスを `EDGE_MODES` で登録
- **Modify** `src/pose-particles/ui/SettingsPanel.ts` — `Edges > Wave` / `Edges > Rewire` サブフォルダ追加

---

## Task 1: settings に wave / rewire 型と defaults を追加

**Files:**
- Modify: `src/pose-particles/settings.ts`

- [ ] **Step 1: Settings 型を拡張するテストを追加**

`src/pose-particles/settings.test.ts` を新規作成 (既存なら追記):

```typescript
import { describe, expect, test } from "bun:test";
import { makeDefaultSettings } from "./settings";

describe("Settings.edges new fields", () => {
  test("wave defaults are present and within documented ranges", () => {
    const s = makeDefaultSettings();
    expect(s.edges.wave.enabled).toBe(false);
    expect(s.edges.wave.subdivisions).toBe(8);
    expect(s.edges.wave.amplitude).toBeCloseTo(0.05);
    expect(s.edges.wave.audioBoost).toBeCloseTo(1.0);
    expect(s.edges.wave.scale).toBeCloseTo(2.0);
    expect(s.edges.wave.speed).toBeCloseTo(0.6);
  });

  test("rewire defaults are present and within documented ranges", () => {
    const s = makeDefaultSettings();
    expect(s.edges.rewire.enabled).toBe(false);
    expect(s.edges.rewire.interval).toBeCloseTo(1.5);
    expect(s.edges.rewire.fraction).toBeCloseTo(0.3);
    expect(s.edges.rewire.fadeDuration).toBeCloseTo(0.4);
    expect(s.edges.rewire.candidatePool).toBeGreaterThanOrEqual(s.edges.kNeighbors);
  });

  test("legacy edges fields are unchanged", () => {
    const s = makeDefaultSettings();
    expect(s.edges.enabled).toBe(false);
    expect(s.edges.anchorCount).toBe(64);
    expect(s.edges.kNeighbors).toBe(2);
    expect(s.edges.alpha).toBe(0.5);
  });
});
```

- [ ] **Step 2: テストを実行して fail を確認**

Run: `cd .worktrees/31-edges-fluctuation && bun test src/pose-particles/settings.test.ts`
Expected: FAIL (`s.edges.wave` is undefined)

- [ ] **Step 3: settings.ts の `Settings` interface と makeDefaultSettings を拡張**

`src/pose-particles/settings.ts:205-214` 周辺の `edges` ブロックを置き換え:

```typescript
  edges: {
    /** Draw edges between anchor points (sub-render layer). */
    enabled: boolean;
    /** Number of anchor points (16..256). */
    anchorCount: number;
    /** k-nearest neighbours each anchor connects to. 1..5. */
    kNeighbors: number;
    /** Edge brightness 0..1. */
    alpha: number;
    /** Per-edge wavy displacement driven by 3D value noise + bass (Issue #31). */
    wave: EdgesWaveSettings;
    /** Periodic rewiring of edges with cross-fade (Issue #31). */
    rewire: EdgesRewireSettings;
  };
```

その上のあたり (TwistSettings/BlurSettings の隣接) に新 interface を追加:

```typescript
/** Edges 波打ち (Issue #31)。 */
export interface EdgesWaveSettings {
  /** 波打ち on/off。 */
  enabled: boolean;
  /** 1 エッジを何分割するか。2..16。 */
  subdivisions: number;
  /** 振幅基準 (world m)。0..0.5。 */
  amplitude: number;
  /** bass による振幅倍率の係数。amp_eff = amplitude * (1 + bass * audioBoost)。0..3。 */
  audioBoost: number;
  /** ノイズ空間周波数。0.5..10。 */
  scale: number;
  /** ノイズ流速 (時間方向)。0..3。 */
  speed: number;
}

/** Edges リワイヤ (Issue #31)。 */
export interface EdgesRewireSettings {
  /** リワイヤ on/off。 */
  enabled: boolean;
  /** 切替周期 (秒)。0.2..5.0。0 で実質オフ扱い。 */
  interval: number;
  /** 各周期で差し替えるエッジ割合。0..1。 */
  fraction: number;
  /** クロスフェード時間 (秒)。0.05..1.0。 */
  fadeDuration: number;
  /** 候補プール幅 (最近傍 M 個から k 本選ぶ)。kNeighbors..2*kNeighbors 程度。 */
  candidatePool: number;
}
```

`makeDefaultSettings` 内の `edges:` ブロックを更新 (settings.ts:344-349):

```typescript
    edges: {
      enabled: false,
      anchorCount: 64,
      kNeighbors: 2,
      alpha: 0.5,
      wave: {
        enabled: false,
        subdivisions: 8,
        amplitude: 0.05,
        audioBoost: 1.0,
        scale: 2.0,
        speed: 0.6,
      },
      rewire: {
        enabled: false,
        interval: 1.5,
        fraction: 0.3,
        fadeDuration: 0.4,
        candidatePool: 4,
      },
    },
```

- [ ] **Step 4: テストを再実行して pass を確認**

Run: `cd .worktrees/31-edges-fluctuation && bun test src/pose-particles/settings.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: 既存テスト全件 (deepMerge 経由のロードを含む) が壊れていないか確認**

Run: `cd .worktrees/31-edges-fluctuation && bun test`
Expected: PASS (197 + 3 = 200 tests)

- [ ] **Step 6: Commit**

```bash
cd .worktrees/31-edges-fluctuation
git add src/pose-particles/settings.ts src/pose-particles/settings.test.ts
git commit -m "#31 feat: edges.wave / edges.rewire の Settings 型と既定値を追加"
```

---

## Task 2: 決定論的 3D value noise の実装

**Files:**
- Create: `src/pose-particles/visuals/value-noise.ts`
- Create: `src/pose-particles/visuals/value-noise.test.ts`

- [ ] **Step 1: テストを書く**

`src/pose-particles/visuals/value-noise.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { noise3D } from "./value-noise";

describe("noise3D", () => {
  test("range is [-1, 1]", () => {
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < 5000; i++) {
      const x = i * 0.137;
      const y = i * 0.241;
      const z = i * 0.353;
      const n = noise3D(x, y, z);
      if (n < min) min = n;
      if (n > max) max = n;
      expect(n).toBeGreaterThanOrEqual(-1);
      expect(n).toBeLessThanOrEqual(1);
    }
    // 十分大きなサンプルなら ±0.5 以上は到達するはず (値が常に 0 ではない保証)
    expect(max).toBeGreaterThan(0.3);
    expect(min).toBeLessThan(-0.3);
  });

  test("deterministic: same input gives same output", () => {
    expect(noise3D(1.2, 3.4, 5.6)).toBe(noise3D(1.2, 3.4, 5.6));
  });

  test("continuous: small input perturbation produces small output change", () => {
    const a = noise3D(2.0, 1.5, 0.7);
    const b = noise3D(2.001, 1.5, 0.7);
    expect(Math.abs(a - b)).toBeLessThan(0.05);
  });

  test("non-trivial: noise3D(x, y, z) varies with each axis", () => {
    const base = noise3D(0, 0, 0);
    const dx = noise3D(1.7, 0, 0);
    const dy = noise3D(0, 1.7, 0);
    const dz = noise3D(0, 0, 1.7);
    expect(dx).not.toBeCloseTo(base, 3);
    expect(dy).not.toBeCloseTo(base, 3);
    expect(dz).not.toBeCloseTo(base, 3);
  });
});
```

- [ ] **Step 2: テストを fail させる**

Run: `cd .worktrees/31-edges-fluctuation && bun test src/pose-particles/visuals/value-noise.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: value-noise.ts を実装**

`src/pose-particles/visuals/value-noise.ts`:

```typescript
/**
 * 決定論的 3D value noise。
 *
 * 整数格子点に hash でランダム値 (-1..1) を割り当て、入力を 3 軸方向に
 * smoothstep 補間する。Perlin より軽く、テクスチャ不要で CPU から呼べる。
 * Issue #31 の EdgeOverlay 波打ちで使用。
 */

/** 32bit 整数ハッシュ → -1..1 の浮動小数。 */
function hash(ix: number, iy: number, iz: number): number {
  let h = ix * 374761393 + iy * 668265263 + iz * 2147483647;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return (h / 0xffffffff) * 2 - 1;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * 3D value noise。値域は [-1, 1]。連続だが C1 連続性のみ (value noise)。
 */
export function noise3D(x: number, y: number, z: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const xf = x - xi;
  const yf = y - yi;
  const zf = z - zi;
  const u = smoothstep(xf);
  const v = smoothstep(yf);
  const w = smoothstep(zf);

  const c000 = hash(xi,     yi,     zi);
  const c100 = hash(xi + 1, yi,     zi);
  const c010 = hash(xi,     yi + 1, zi);
  const c110 = hash(xi + 1, yi + 1, zi);
  const c001 = hash(xi,     yi,     zi + 1);
  const c101 = hash(xi + 1, yi,     zi + 1);
  const c011 = hash(xi,     yi + 1, zi + 1);
  const c111 = hash(xi + 1, yi + 1, zi + 1);

  const x00 = c000 * (1 - u) + c100 * u;
  const x10 = c010 * (1 - u) + c110 * u;
  const x01 = c001 * (1 - u) + c101 * u;
  const x11 = c011 * (1 - u) + c111 * u;
  const y0 = x00 * (1 - v) + x10 * v;
  const y1 = x01 * (1 - v) + x11 * v;
  return y0 * (1 - w) + y1 * w;
}
```

- [ ] **Step 4: テストを pass させる**

Run: `cd .worktrees/31-edges-fluctuation && bun test src/pose-particles/visuals/value-noise.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
cd .worktrees/31-edges-fluctuation
git add src/pose-particles/visuals/value-noise.ts src/pose-particles/visuals/value-noise.test.ts
git commit -m "#31 feat: 決定論的 3D value noise ユーティリティを追加"
```

---

## Task 3: EdgeOverlay の細分化レンダリング (wave/rewire 無効時は現状一致)

**Files:**
- Modify: `src/pose-particles/visuals/EdgeOverlay.ts`
- Modify: `src/pose-particles/visuals/EdgeOverlay.test.ts`

このタスクではまず「分割数 = 1 (=現状)」の挙動を維持しつつ、内部的に "論理エッジ + サブセグメント" に書き換える。波打ち・リワイヤは次タスク以降。

- [ ] **Step 1: 後方互換テストを追加**

`src/pose-particles/visuals/EdgeOverlay.test.ts` の末尾に追記:

```typescript
import * as THREE from "three";

describe("EdgeOverlay backward compatibility", () => {
  test("wave/rewire OFF: drawRange と頂点位置が現状仕様と一致 (分割なし)", () => {
    const overlay = new EdgeOverlay();
    const settings = makeDefaultSettings();
    settings.edges.enabled = true;
    settings.edges.anchorCount = 16;
    settings.edges.kNeighbors = 2;
    settings.mode = "sphere";
    settings.outlier.boost = 1.0;
    settings.twist.enabled = false;
    const joints = makeEmptyJoints();
    const center = new Float32Array([0, 0, 0]);
    const audio = makeAudio();

    overlay.update(joints, center, audio, settings, 0);

    const geom = overlay.object3D.geometry as THREE.BufferGeometry;
    const count = geom.drawRange.count;
    // anchorCount=16, kNeighbors=2 → 重複除去で総セグメント数は <= 32 だが
    // 厳密値は kNN 結果に依存。少なくとも 1 セグメント以上引かれている。
    expect(count).toBeGreaterThan(0);
    // 各セグメントの 2 端点が、必ず getAnchorPosition() のどれかと一致するはず。
    const pos = geom.attributes.position!.array as Float32Array;
    const anchors: Array<[number, number, number]> = [];
    for (let i = 0; i < 16; i++) anchors.push(overlay.getAnchorPosition(i));
    const matches = (x: number, y: number, z: number): boolean =>
      anchors.some(([ax, ay, az]) =>
        Math.abs(ax - x) < 1e-5 && Math.abs(ay - y) < 1e-5 && Math.abs(az - z) < 1e-5);

    for (let s = 0; s < count; s += 2) {
      const i0 = s * 3;
      const i1 = (s + 1) * 3;
      expect(matches(pos[i0]!, pos[i0 + 1]!, pos[i0 + 2]!)).toBe(true);
      expect(matches(pos[i1]!, pos[i1 + 1]!, pos[i1 + 2]!)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: テスト実行して現状で pass することを確認** (互換動作の正本固定)

Run: `cd .worktrees/31-edges-fluctuation && bun test src/pose-particles/visuals/EdgeOverlay.test.ts`
Expected: PASS (既存 5 + 新規 1 = 6 tests)

- [ ] **Step 3: EdgeOverlay 内部を「論理エッジ + サブセグメント」構造に書き換え**

`src/pose-particles/visuals/EdgeOverlay.ts` のフィールドと constructor を以下のように拡張する (既存処理を保ちつつ追加):

```typescript
const MAX_ANCHORS = 256;
const MAX_K = 5;
const MAX_SUBDIVISIONS = 16;
/** 同時に存在しうる最大エッジ数。リワイヤのフェード中は旧+新が並列するため 2x。 */
const MAX_EDGES = MAX_ANCHORS * MAX_K * 2;
/** サブセグメント = エッジ × 分割数。 */
const MAX_SUB_SEGMENTS = MAX_EDGES * MAX_SUBDIVISIONS;
```

`positions` / geometry attribute を `MAX_SUB_SEGMENTS * 2 * 3` で再確保し、追加で `colors` (vec3 per vertex) を導入。`LineBasicMaterial` を `vertexColors: true` に変更:

```typescript
this.positions = new Float32Array(MAX_SUB_SEGMENTS * 2 * 3);
this.colors = new Float32Array(MAX_SUB_SEGMENTS * 2 * 3);
const geo = new THREE.BufferGeometry();
this.posAttr = new THREE.BufferAttribute(this.positions, 3);
this.posAttr.setUsage(THREE.DynamicDrawUsage);
this.colorAttr = new THREE.BufferAttribute(this.colors, 3);
this.colorAttr.setUsage(THREE.DynamicDrawUsage);
geo.setAttribute("position", this.posAttr);
geo.setAttribute("color", this.colorAttr);
geo.setDrawRange(0, 0);
geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 4);

const mat = new THREE.LineBasicMaterial({
  color: 0xffffff,
  vertexColors: true,
  transparent: true,
  opacity: 0.5,
  depthTest: false,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
});
```

論理エッジを保持する State 配列を追加 (size = MAX_EDGES, slot ベース、`active` フラグで管理):

```typescript
type FadeState = "in" | "stable" | "out";
private edgeActive: Uint8Array;        // 1 ならスロット使用中
private edgeA: Int32Array;
private edgeB: Int32Array;
private edgeFadeState: Uint8Array;     // 0=in, 1=stable, 2=out
private edgeFadeStartT: Float32Array;
private edgeFadeFrom: Float32Array;
private edgeFadeTo: Float32Array;
private edgeCount = 0;                 // 使用中スロット数 (集計用キャッシュ)
private lastRewireT = -Infinity;       // 最後のリワイヤ時刻
```

constructor で全 MAX_EDGES 分を allocate (初期値 0)。

`update()` 内では:

1. アンカー位置計算 (既存ロジック維持)
2. **kNN 結線フェーズ** を「**stable な論理エッジ集合** を求めるフェーズ」に置換。`rewire.enabled = false` のとき: 毎フレーム kNN 結果で stable な edgeA/edgeB を全置換 (active edge slot を完全に書き直し、すべて `fadeState=stable, fadeAlpha=1`)。
3. リワイヤは Task 5 で実装するため、ここではフラグ無視。
4. **emit フェーズ**: 全 active edge について、`wave.enabled && subdivisions > 1` なら分割数 S、そうでなければ 1 として、`writeSubSegments(a, b, S, alpha)` を呼ぶ。alpha は edge の現在 fade alpha。

`writeSubSegments` は:
- S=1 の場合: 既存と同じく (A, B) の 1 セグメントを書く。alpha は両端点の vertex color に流す。
- S>1 の場合: u=0..S を S+1 個サンプルし、`S 個` のサブセグメント `(p_k, p_{k+1})` を書く。

このタスクでは `S=1` のみ動作させればよい (`writeSubSegments` 実装は最低限)。

- [ ] **Step 4: 互換テスト + 既存テストが pass することを確認**

Run: `cd .worktrees/31-edges-fluctuation && bun test src/pose-particles/visuals/EdgeOverlay.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: 全件テスト**

Run: `cd .worktrees/31-edges-fluctuation && bun test`
Expected: PASS (204 tests)

- [ ] **Step 6: Commit**

```bash
cd .worktrees/31-edges-fluctuation
git add src/pose-particles/visuals/EdgeOverlay.ts src/pose-particles/visuals/EdgeOverlay.test.ts
git commit -m "#31 refactor: EdgeOverlay を論理エッジ+サブセグメント構造に再構成 (挙動互換)"
```

---

## Task 4: 波打ち (wave) の実装

**Files:**
- Modify: `src/pose-particles/visuals/EdgeOverlay.ts`
- Modify: `src/pose-particles/visuals/EdgeOverlay.test.ts`

- [ ] **Step 1: 波打ちのテストを追加**

`EdgeOverlay.test.ts` 末尾に追記:

```typescript
import { noise3D } from "./value-noise";

describe("EdgeOverlay wave", () => {
  function setupWave(): { overlay: EdgeOverlay; settings: ReturnType<typeof makeDefaultSettings>; joints: Float32Array; center: Float32Array; audio: AudioFeatures } {
    const overlay = new EdgeOverlay();
    const settings = makeDefaultSettings();
    settings.edges.enabled = true;
    settings.edges.anchorCount = 16;
    settings.edges.kNeighbors = 1;
    settings.mode = "sphere";
    settings.outlier.boost = 1.0;
    settings.twist.enabled = false;
    settings.edges.wave.enabled = true;
    settings.edges.wave.subdivisions = 8;
    settings.edges.wave.amplitude = 0.1;
    settings.edges.wave.audioBoost = 0;
    settings.edges.wave.scale = 2.0;
    settings.edges.wave.speed = 0;
    const joints = makeEmptyJoints();
    const center = new Float32Array([0, 0, 0]);
    const audio = makeAudio();
    return { overlay, settings, joints, center, audio };
  }

  test("wave ON でも各サブセグメント連鎖の両端は anchor に一致する", () => {
    const { overlay, settings, joints, center, audio } = setupWave();
    overlay.update(joints, center, audio, settings, 0);
    const geom = overlay.object3D.geometry as THREE.BufferGeometry;
    const pos = geom.attributes.position!.array as Float32Array;
    const count = geom.drawRange.count;
    // count = エッジ数 * subdivisions * 2 vertices
    const S = settings.edges.wave.subdivisions;
    expect(count % (S * 2)).toBe(0);
    const numEdges = count / (S * 2);
    for (let e = 0; e < numEdges; e++) {
      // エッジ e の最初のサブセグメント開始点 = アンカー A
      // エッジ e の最後のサブセグメント終了点 = アンカー B
      const startIdx = e * S * 2 * 3;
      const endIdx = (e * S * 2 + S * 2 - 1) * 3;
      const ax = pos[startIdx]!, ay = pos[startIdx + 1]!, az = pos[startIdx + 2]!;
      const bx = pos[endIdx]!, by = pos[endIdx + 1]!, bz = pos[endIdx + 2]!;
      // 両端が anchor 集合のどれかと一致 (端点には変位がかからない)
      let foundA = false, foundB = false;
      for (let i = 0; i < 16; i++) {
        const [px, py, pz] = overlay.getAnchorPosition(i);
        if (Math.abs(px - ax) < 1e-5 && Math.abs(py - ay) < 1e-5 && Math.abs(pz - az) < 1e-5) foundA = true;
        if (Math.abs(px - bx) < 1e-5 && Math.abs(py - by) < 1e-5 && Math.abs(pz - bz) < 1e-5) foundB = true;
      }
      expect(foundA).toBe(true);
      expect(foundB).toBe(true);
    }
  });

  test("amplitude=0 → 全サブセグメント頂点が直線上に乗る", () => {
    const { overlay, settings, joints, center, audio } = setupWave();
    settings.edges.wave.amplitude = 0;
    overlay.update(joints, center, audio, settings, 0);
    const geom = overlay.object3D.geometry as THREE.BufferGeometry;
    const pos = geom.attributes.position!.array as Float32Array;
    const count = geom.drawRange.count;
    const S = settings.edges.wave.subdivisions;
    const numEdges = count / (S * 2);
    for (let e = 0; e < numEdges; e++) {
      const startIdx = e * S * 2 * 3;
      const endIdx = (e * S * 2 + S * 2 - 1) * 3;
      const ax = pos[startIdx]!, ay = pos[startIdx + 1]!, az = pos[startIdx + 2]!;
      const bx = pos[endIdx]!, by = pos[endIdx + 1]!, bz = pos[endIdx + 2]!;
      // 中間頂点が (A, B) の直線上にあること: (P - A) × (B - A) ≈ 0
      const dx = bx - ax, dy = by - ay, dz = bz - az;
      for (let s = 0; s < S * 2; s++) {
        const idx = (e * S * 2 + s) * 3;
        const px = pos[idx]!, py = pos[idx + 1]!, pz = pos[idx + 2]!;
        const rx = px - ax, ry = py - ay, rz = pz - az;
        const cx = ry * dz - rz * dy;
        const cy = rz * dx - rx * dz;
        const cz = rx * dy - ry * dx;
        expect(Math.sqrt(cx * cx + cy * cy + cz * cz)).toBeLessThan(1e-4);
      }
    }
  });

  test("amplitude>0 → 中間頂点が直線上から外れる (実際に波打つ)", () => {
    const { overlay, settings, joints, center, audio } = setupWave();
    settings.edges.wave.amplitude = 0.1;
    overlay.update(joints, center, audio, settings, 0);
    const geom = overlay.object3D.geometry as THREE.BufferGeometry;
    const pos = geom.attributes.position!.array as Float32Array;
    const count = geom.drawRange.count;
    const S = settings.edges.wave.subdivisions;
    expect(count).toBeGreaterThan(0);
    // 少なくとも 1 つのエッジで、中央サブ頂点が直線から有意に外れている
    let maxDist = 0;
    const numEdges = count / (S * 2);
    for (let e = 0; e < numEdges; e++) {
      const startIdx = e * S * 2 * 3;
      const endIdx = (e * S * 2 + S * 2 - 1) * 3;
      const ax = pos[startIdx]!, ay = pos[startIdx + 1]!, az = pos[startIdx + 2]!;
      const bx = pos[endIdx]!, by = pos[endIdx + 1]!, bz = pos[endIdx + 2]!;
      // 中央サブ頂点 (連鎖の真ん中)
      const midSub = S; // (S*2)/2 = S 番目の vertex index = 中央点
      const idx = (e * S * 2 + midSub) * 3;
      const px = pos[idx]!, py = pos[idx + 1]!, pz = pos[idx + 2]!;
      const mx = (ax + bx) * 0.5, my = (ay + by) * 0.5, mz = (az + bz) * 0.5;
      const d = Math.sqrt((px - mx) ** 2 + (py - my) ** 2 + (pz - mz) ** 2);
      if (d > maxDist) maxDist = d;
    }
    expect(maxDist).toBeGreaterThan(0.005);
  });

  test("speed > 0 → 時刻で中間頂点位置が変化する", () => {
    const { overlay, settings, joints, center, audio } = setupWave();
    settings.edges.wave.speed = 1.0;
    overlay.update(joints, center, audio, settings, 0);
    const pos0 = Float32Array.from(
      (overlay.object3D.geometry.attributes.position!.array as Float32Array).slice(0, 64 * 3),
    );
    overlay.update(joints, center, audio, settings, 2.0);
    const pos1 = (overlay.object3D.geometry.attributes.position!.array as Float32Array).slice(0, 64 * 3);
    let diff = 0;
    for (let i = 0; i < pos0.length; i++) diff += Math.abs(pos0[i]! - pos1[i]!);
    expect(diff).toBeGreaterThan(1e-3);
  });

  test("audioBoost > 0 で bass を上げると変位が大きくなる", () => {
    // amplitude を固定し、audioBoost と bass を変化させた場合の中央点の最大ずれを比較。
    const { overlay, settings, joints, center, audio } = setupWave();
    settings.edges.wave.amplitude = 0.05;
    settings.edges.wave.audioBoost = 2.0;
    const audioLow: AudioFeatures = { ...audio, bass: 0 };
    const audioHigh: AudioFeatures = { ...audio, bass: 1 };
    overlay.update(joints, center, audioLow, settings, 0);
    const posLow = Float32Array.from(
      (overlay.object3D.geometry.attributes.position!.array as Float32Array).slice(0, 64 * 3),
    );
    overlay.update(joints, center, audioHigh, settings, 0);
    const posHigh = (overlay.object3D.geometry.attributes.position!.array as Float32Array).slice(0, 64 * 3);

    // 中央サブ頂点での anchor 中点からの距離を集計
    const S = settings.edges.wave.subdivisions;
    let sumLow = 0, sumHigh = 0;
    const numEdges = 16; // 確実に 16 個以上引かれる (anchorCount=16, k=1)
    for (let e = 0; e < numEdges; e++) {
      const startIdx = e * S * 2 * 3;
      const endIdx = (e * S * 2 + S * 2 - 1) * 3;
      const mid = (e * S * 2 + S) * 3;
      const mxL = (posLow[startIdx]! + posLow[endIdx]!) * 0.5;
      const myL = (posLow[startIdx + 1]! + posLow[endIdx + 1]!) * 0.5;
      const mzL = (posLow[startIdx + 2]! + posLow[endIdx + 2]!) * 0.5;
      sumLow += Math.hypot(posLow[mid]! - mxL, posLow[mid + 1]! - myL, posLow[mid + 2]! - mzL);
      const mxH = (posHigh[startIdx]! + posHigh[endIdx]!) * 0.5;
      const myH = (posHigh[startIdx + 1]! + posHigh[endIdx + 1]!) * 0.5;
      const mzH = (posHigh[startIdx + 2]! + posHigh[endIdx + 2]!) * 0.5;
      sumHigh += Math.hypot(posHigh[mid]! - mxH, posHigh[mid + 1]! - myH, posHigh[mid + 2]! - mzH);
    }
    expect(sumHigh).toBeGreaterThan(sumLow * 1.5);
  });
});
```

- [ ] **Step 2: テストを fail させる**

Run: `cd .worktrees/31-edges-fluctuation && bun test src/pose-particles/visuals/EdgeOverlay.test.ts`
Expected: FAIL (現状は wave 無視で「最後のサブセグメント終了点 = anchor B」のような subdivision 構造になっていない)

- [ ] **Step 3: writeSubSegments の波打ちロジックを実装**

EdgeOverlay の `update` 末尾 emit 段に、wave 有効時の処理を追加。`writeSubSegments(ai, bi, S, alpha, amp_eff, scale, speed, t, edgeSeed)`:

```typescript
private writeSubSegments(
  ai: number, bi: number, S: number, alpha: number,
  ampEff: number, scale: number, speed: number, t: number,
  edgeSeed: number,
): void {
  const ax = this.anchorPos[ai * 3]!, ay = this.anchorPos[ai * 3 + 1]!, az = this.anchorPos[ai * 3 + 2]!;
  const bx = this.anchorPos[bi * 3]!, by = this.anchorPos[bi * 3 + 1]!, bz = this.anchorPos[bi * 3 + 2]!;
  const tx = bx - ax, ty = by - ay, tz = bz - az;
  const tLen = Math.hypot(tx, ty, tz) || 1;
  const tnx = tx / tLen, tny = ty / tLen, tnz = tz / tLen;
  // 直交基底 N, B を作る (Hughes-Möller 法: t と単位ベクトルの中で「最も垂直」なものから cross)
  let ux = 0, uy = 0, uz = 0;
  if (Math.abs(tnx) <= Math.abs(tny) && Math.abs(tnx) <= Math.abs(tnz)) ux = 1;
  else if (Math.abs(tny) <= Math.abs(tnz)) uy = 1;
  else uz = 1;
  // n = normalize(cross(t, u))
  let nx = tny * uz - tnz * uy;
  let ny = tnz * ux - tnx * uz;
  let nz = tnx * uy - tny * ux;
  const nLen = Math.hypot(nx, ny, nz) || 1;
  nx /= nLen; ny /= nLen; nz /= nLen;
  // b = cross(t, n)
  const bnx = tny * nz - tnz * ny;
  const bny = tnz * nx - tnx * nz;
  const bnz = tnx * ny - tny * nx;

  // 共有: 端点位置の関数
  const sample = (sIdx: number): [number, number, number] => {
    const u = sIdx / S;
    if (sIdx === 0) return [ax, ay, az];
    if (sIdx === S) return [bx, by, bz];
    // sin(π u) で端点 0、中央 1 のウェイト
    const w = Math.sin(Math.PI * u);
    const px = ax + tx * u;
    const py = ay + ty * u;
    const pz = az + tz * u;
    const noiseN = noise3D(u * scale + edgeSeed, t * speed, edgeSeed * 0.37);
    const noiseB = noise3D(u * scale + edgeSeed + 13.1, t * speed + 7.7, edgeSeed * 0.73);
    const dN = ampEff * w * noiseN;
    const dB = ampEff * w * noiseB;
    return [
      px + nx * dN + bnx * dB,
      py + ny * dN + bny * dB,
      pz + nz * dN + bnz * dB,
    ];
  };

  for (let k = 0; k < S; k++) {
    const [p0x, p0y, p0z] = sample(k);
    const [p1x, p1y, p1z] = sample(k + 1);
    const off = this.segCount * 6;
    this.positions[off + 0] = p0x; this.positions[off + 1] = p0y; this.positions[off + 2] = p0z;
    this.positions[off + 3] = p1x; this.positions[off + 4] = p1y; this.positions[off + 5] = p1z;
    this.colors[off + 0] = alpha; this.colors[off + 1] = alpha; this.colors[off + 2] = alpha;
    this.colors[off + 3] = alpha; this.colors[off + 4] = alpha; this.colors[off + 5] = alpha;
    this.segCount++;
  }
}
```

`this.segCount` はフレーム毎にゼロ初期化するインスタンス変数。emit ループでは `wave.enabled && wave.subdivisions > 1` なら S = `clamp(2, 16, floor(subdivisions))`、それ以外なら S=1。`ampEff = wave.amplitude * (1 + bass * wave.audioBoost)`。`edgeSeed` は `ai * 1009 + bi * 13` 等。

- [ ] **Step 4: 全テスト pass を確認**

Run: `cd .worktrees/31-edges-fluctuation && bun test src/pose-particles/visuals/EdgeOverlay.test.ts`
Expected: PASS (11 tests)

- [ ] **Step 5: 全体テスト**

Run: `cd .worktrees/31-edges-fluctuation && bun test`
Expected: PASS (209 tests)

- [ ] **Step 6: Commit**

```bash
cd .worktrees/31-edges-fluctuation
git add src/pose-particles/visuals/EdgeOverlay.ts src/pose-particles/visuals/EdgeOverlay.test.ts
git commit -m "#31 feat: EdgeOverlay にノイズ波打ち (bass 連動) を追加"
```

---

## Task 5: リワイヤ + フェードの実装

**Files:**
- Modify: `src/pose-particles/visuals/EdgeOverlay.ts`
- Modify: `src/pose-particles/visuals/EdgeOverlay.test.ts`

- [ ] **Step 1: リワイヤのテストを追加**

`EdgeOverlay.test.ts` 末尾に追記:

```typescript
describe("EdgeOverlay rewire", () => {
  function setup(rewireEnabled: boolean, interval: number, fraction: number, fadeDuration: number): {
    overlay: EdgeOverlay;
    settings: ReturnType<typeof makeDefaultSettings>;
    joints: Float32Array;
    center: Float32Array;
    audio: AudioFeatures;
  } {
    const overlay = new EdgeOverlay();
    const settings = makeDefaultSettings();
    settings.edges.enabled = true;
    settings.edges.anchorCount = 16;
    settings.edges.kNeighbors = 1;
    settings.mode = "sphere";
    settings.outlier.boost = 1.0;
    settings.twist.enabled = false;
    settings.edges.wave.enabled = false;
    settings.edges.rewire.enabled = rewireEnabled;
    settings.edges.rewire.interval = interval;
    settings.edges.rewire.fraction = fraction;
    settings.edges.rewire.fadeDuration = fadeDuration;
    settings.edges.rewire.candidatePool = 4;
    const joints = makeEmptyJoints();
    const center = new Float32Array([0, 0, 0]);
    const audio = makeAudio();
    return { overlay, settings, joints, center, audio };
  }

  function getEdgeKeys(overlay: EdgeOverlay): Set<string> {
    return new Set(overlay.debugListEdges().map(([a, b]) => `${Math.min(a, b)}-${Math.max(a, b)}`));
  }

  test("rewire OFF: 何度 update してもエッジ集合は不変", () => {
    const { overlay, settings, joints, center, audio } = setup(false, 1.5, 0.3, 0.4);
    overlay.update(joints, center, audio, settings, 0);
    const before = getEdgeKeys(overlay);
    for (let i = 1; i <= 20; i++) overlay.update(joints, center, audio, settings, i * 0.1);
    const after = getEdgeKeys(overlay);
    expect([...after].sort()).toEqual([...before].sort());
  });

  test("rewire interval=0: リワイヤは発火しない", () => {
    const { overlay, settings, joints, center, audio } = setup(true, 0, 0.5, 0.4);
    overlay.update(joints, center, audio, settings, 0);
    const before = getEdgeKeys(overlay);
    overlay.update(joints, center, audio, settings, 5);
    overlay.update(joints, center, audio, settings, 10);
    const after = getEdgeKeys(overlay);
    expect([...after].sort()).toEqual([...before].sort());
  });

  test("interval 経過後、stable なエッジが部分的に新しいものに置換される", () => {
    const { overlay, settings, joints, center, audio } = setup(true, 0.5, 0.5, 0.2);
    overlay.update(joints, center, audio, settings, 0);
    const before = getEdgeKeys(overlay);
    // フェード時間 + 余白を含めて十分時間進める
    overlay.update(joints, center, audio, settings, 0.6);
    // すぐにはまだ stable に落ちていない可能性があるので、fade 完了まで待つ
    overlay.update(joints, center, audio, settings, 1.0);
    const after = getEdgeKeys(overlay);
    // 入れ替わったエッジが少なくとも 1 本以上ある
    let diff = 0;
    for (const k of after) if (!before.has(k)) diff++;
    expect(diff).toBeGreaterThan(0);
  });

  test("fade-in 中: 直後の vertex color (alpha 等価) は 0 に近い", () => {
    const { overlay, settings, joints, center, audio } = setup(true, 0.5, 1.0, 0.4);
    overlay.update(joints, center, audio, settings, 0);
    // 全 stable エッジは color=1
    overlay.update(joints, center, audio, settings, 0.51);
    // この時点で fraction=1 だった場合 fade-out が走り、新エッジが fade-in 中
    const colors = overlay.object3D.geometry.attributes.color!.array as Float32Array;
    const count = overlay.object3D.geometry.drawRange.count;
    let minColor = 1.0;
    let maxColor = 0.0;
    for (let i = 0; i < count; i++) {
      const c = colors[i * 3]!;
      if (c < minColor) minColor = c;
      if (c > maxColor) maxColor = c;
    }
    expect(minColor).toBeLessThan(0.2); // 新エッジ群はまだ薄い
    expect(maxColor).toBeGreaterThan(0.8); // 旧エッジ群はまだ濃い
  });

  test("fade 完了後、すべてのエッジ color が 1 に戻る", () => {
    const { overlay, settings, joints, center, audio } = setup(true, 0.5, 1.0, 0.2);
    overlay.update(joints, center, audio, settings, 0);
    overlay.update(joints, center, audio, settings, 0.51); // rewire trigger
    overlay.update(joints, center, audio, settings, 1.5); // > 0.51 + fadeDuration
    const colors = overlay.object3D.geometry.attributes.color!.array as Float32Array;
    const count = overlay.object3D.geometry.drawRange.count;
    for (let i = 0; i < count; i++) {
      expect(colors[i * 3]!).toBeCloseTo(1, 5);
    }
  });
});
```

なお `overlay.debugListEdges()` は EdgeOverlay に新規追加するデバッグ用 API: `Array<[a, b, fadeState, alpha]>` のような形で active edge のスナップショットを返す。テストでは a, b のみ使うので戻り値は `[a, b]` のペア配列で十分。

- [ ] **Step 2: テスト fail を確認**

Run: `cd .worktrees/31-edges-fluctuation && bun test src/pose-particles/visuals/EdgeOverlay.test.ts`
Expected: FAIL (`overlay.debugListEdges is not a function`)

- [ ] **Step 3: rewire スケジューラとフェードを実装**

EdgeOverlay.update() の構造を以下に変える:

```typescript
update(joints, center, audio, settings, t) {
  // ... mode visibility / opacity 共通処理 (既存) ...
  // 1. アンカー位置を計算 (既存ロジック)

  const e = settings.edges;
  const N = ...; const K = ...;

  const rewireOn = e.rewire.enabled && e.rewire.interval > 0;

  if (!rewireOn) {
    // 毎フレーム kNN 結線で edge set を完全に書き直し、すべて stable+alpha=1
    this.rebuildEdgesFromKNN(N, K);
  } else {
    // 初回または anchorCount/kNeighbors 変化時: edge set を初期化
    if (this.edgeCount === 0) {
      this.rebuildEdgesFromKNN(N, K);
      this.lastRewireT = t;
    }
    // interval 経過: rewire
    if (t - this.lastRewireT >= e.rewire.interval) {
      this.rewireSome(N, K, e.rewire.fraction, e.rewire.candidatePool, t);
      this.lastRewireT = t;
    }
    // 各エッジの fade を進める
    this.advanceFades(t, e.rewire.fadeDuration);
  }

  // 2. emit
  this.segCount = 0;
  const ampEff = e.wave.amplitude * (1 + audio.bass * e.wave.audioBoost);
  const S = e.wave.enabled ? Math.max(2, Math.min(MAX_SUBDIVISIONS, Math.floor(e.wave.subdivisions))) : 1;

  for (let slot = 0; slot < MAX_EDGES; slot++) {
    if (!this.edgeActive[slot]) continue;
    const a = this.edgeA[slot]!, b = this.edgeB[slot]!;
    const alpha = this.computeEdgeAlpha(slot, t, e.rewire.fadeDuration);
    if (alpha <= 0) continue;
    const seed = (a * 1009 + b * 13) % 1000;
    this.writeSubSegments(a, b, S, alpha, ampEff, e.wave.scale, e.wave.speed, t, seed);
  }

  this.posAttr.needsUpdate = true;
  this.colorAttr.needsUpdate = true;
  this.object3D.geometry.setDrawRange(0, this.segCount * 2);
}
```

`rebuildEdgesFromKNN(N, K)`:
- 既存の kNN ロジックで unique (a, b) ペアを集める
- すべての edgeActive をリセット
- 集めたペアを slot に詰め、`fadeState=stable, fadeFrom=fadeTo=1, fadeStartT=-Infinity`

`rewireSome(N, K, fraction, candidatePool, t)`:
- 現在 stable な active edges を列挙
- `Math.round(fraction * stable.length)` 本を mulberry32 シード付きで選び `fadeState=out, fadeFrom=current, fadeTo=0, fadeStartT=t` に変更
- 同数の新規エッジを生成: 各退役エッジの片端 `a` から、anchorPos の距離で M = `max(K, floor(candidatePool))` 個の最近傍を取り、現在 active な (a, x) ペアと重複しないものをランダムに 1 本選ぶ。失敗時は全アンカーからランダムに選ぶ fallback。新規エッジは新しい slot に追加し `fadeState=in, fadeFrom=0, fadeTo=1, fadeStartT=t`

`advanceFades(t, fadeDuration)`:
- 全 active edge を走査
- `out` で alpha が 0 に到達 (現在の alpha = `lerp(from, to, clamp((t-start)/fadeDuration, 0, 1))` で 0) → `edgeActive[slot] = 0`
- `in` で alpha が 1 に到達 → `fadeState=stable`

`computeEdgeAlpha(slot, t, fadeDuration)`:
- `stable` → fadeTo (=1)
- それ以外 → `lerp(fadeFrom, fadeTo, clamp((t - fadeStartT) / fadeDuration, 0, 1))`

`debugListEdges()`:

```typescript
debugListEdges(): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let slot = 0; slot < MAX_EDGES; slot++) {
    if (!this.edgeActive[slot]) continue;
    if (this.edgeFadeState[slot] !== STATE_OUT) {
      out.push([this.edgeA[slot]!, this.edgeB[slot]!]);
    }
  }
  return out;
}
```

(out 中のエッジは "古い" 側なのでテスト的に除外し、in/stable のみを返す。)

- [ ] **Step 4: テスト pass を確認**

Run: `cd .worktrees/31-edges-fluctuation && bun test src/pose-particles/visuals/EdgeOverlay.test.ts`
Expected: PASS (16 tests)

- [ ] **Step 5: 全体テスト**

Run: `cd .worktrees/31-edges-fluctuation && bun test`
Expected: PASS (214 tests)

- [ ] **Step 6: Commit**

```bash
cd .worktrees/31-edges-fluctuation
git add src/pose-particles/visuals/EdgeOverlay.ts src/pose-particles/visuals/EdgeOverlay.test.ts
git commit -m "#31 feat: EdgeOverlay に一定間隔リワイヤ + クロスフェードを追加"
```

---

## Task 6: GUI と doc/relevance に登録

**Files:**
- Modify: `src/pose-particles/ui/param-docs.ts`
- Modify: `src/pose-particles/ui/param-relevance.ts`
- Modify: `src/pose-particles/ui/SettingsPanel.ts`

- [ ] **Step 1: relevance テストを先に書く**

`src/pose-particles/ui/param-relevance.test.ts` に追加 (既存テストの末尾):

```typescript
test("edges.wave.* / edges.rewire.* は bones/cube/sphere でのみ active", () => {
  const paths = [
    "edges.wave.enabled", "edges.wave.subdivisions", "edges.wave.amplitude",
    "edges.wave.audioBoost", "edges.wave.scale", "edges.wave.speed",
    "edges.rewire.enabled", "edges.rewire.interval", "edges.rewire.fraction",
    "edges.rewire.fadeDuration", "edges.rewire.candidatePool",
  ];
  for (const p of paths) {
    expect(paramActiveForMode(p, "bones")).toBe(true);
    expect(paramActiveForMode(p, "cube")).toBe(true);
    expect(paramActiveForMode(p, "sphere")).toBe(true);
    expect(paramActiveForMode(p, "lattice")).toBe(false);
    expect(paramActiveForMode(p, "image")).toBe(false);
    expect(paramActiveForMode(p, "rain")).toBe(false);
  }
});
```

- [ ] **Step 2: fail を確認**

Run: `cd .worktrees/31-edges-fluctuation && bun test src/pose-particles/ui/param-relevance.test.ts`
Expected: FAIL (fail-open のため `paramActiveForMode("edges.wave.enabled", "lattice")` が true を返す)

- [ ] **Step 3: param-relevance.ts に新パスを追加**

`src/pose-particles/ui/param-relevance.ts` の RELEVANCE map に追加 (既存 `edges.alpha` の直後):

```typescript
  "edges.wave.enabled": new Set(EDGE_MODES),
  "edges.wave.subdivisions": new Set(EDGE_MODES),
  "edges.wave.amplitude": new Set(EDGE_MODES),
  "edges.wave.audioBoost": new Set(EDGE_MODES),
  "edges.wave.scale": new Set(EDGE_MODES),
  "edges.wave.speed": new Set(EDGE_MODES),

  "edges.rewire.enabled": new Set(EDGE_MODES),
  "edges.rewire.interval": new Set(EDGE_MODES),
  "edges.rewire.fraction": new Set(EDGE_MODES),
  "edges.rewire.fadeDuration": new Set(EDGE_MODES),
  "edges.rewire.candidatePool": new Set(EDGE_MODES),
```

- [ ] **Step 4: relevance テスト pass を確認**

Run: `cd .worktrees/31-edges-fluctuation && bun test src/pose-particles/ui/param-relevance.test.ts`
Expected: PASS

- [ ] **Step 5: param-docs.ts に新項目追加**

`src/pose-particles/ui/param-docs.ts` の `edges.alpha` 直後に追加:

```typescript
  "edges.wave.enabled": {
    summary: "エッジを細分化しノイズで波打たせるか (Issue #31)。",
    effect: "ON で各エッジが内部頂点ごとに揺らぎ、生きたワイヤのように見える。OFF で直線。",
  },
  "edges.wave.subdivisions": {
    summary: "1 エッジを何分割するか (2..16)。",
    effect: "上げるほど波形がなめらか・細かくなる。下げるとカクついた折れ線になる。",
  },
  "edges.wave.amplitude": {
    summary: "波の振幅基準 (world m, 0..0.5)。",
    effect: "上げるほどエッジが大きくうねる。0 で実質直線。",
  },
  "edges.wave.audioBoost": {
    summary: "bass による振幅ブースト係数 (0..3)。amp_eff = amplitude * (1 + bass * audioBoost)。",
    effect: "上げると低音が強いとき大きく揺れる。0 で音と無関係な定常揺らぎ。",
  },
  "edges.wave.scale": {
    summary: "ノイズ空間周波数 (0.5..10)。",
    effect: "上げるとエッジ上で細かく波打つ。下げるとゆったり大きくうねる。",
  },
  "edges.wave.speed": {
    summary: "ノイズ流速 (0..3)。波形が時間方向に流れる速さ。",
    effect: "上げるほど波が速く動く。0 で時間停止 (静的な波)。",
  },

  "edges.rewire.enabled": {
    summary: "エッジの結線を一定間隔でランダムに差し替えるか (Issue #31)。",
    effect: "ON でエッジ構成が周期的に変わり、フェードで自然に入れ替わる。OFF で固定。",
  },
  "edges.rewire.interval": {
    summary: "リワイヤの周期 (秒, 0.2..5.0)。0 で実質オフ扱い。",
    effect: "短いほど頻繁にエッジが入れ替わる。長いと変化がゆっくり。",
  },
  "edges.rewire.fraction": {
    summary: "各周期で差し替えるエッジ割合 (0..1)。",
    effect: "上げるほど一度に多くのエッジが入れ替わる。0 で何も入れ替わらない。",
  },
  "edges.rewire.fadeDuration": {
    summary: "古/新エッジのクロスフェード時間 (秒, 0.05..1.0)。",
    effect: "短いとパッと切り替わる印象。長いと滑らかに溶けるように入れ替わる。",
  },
  "edges.rewire.candidatePool": {
    summary: "新エッジ候補プール幅 (近傍 M 本から k 本選ぶ, kNeighbors..2*kNeighbors 目安)。",
    effect: "小さいほど局所的な再結線で似た見た目を保つ。大きいほど大胆に組み替わる。",
  },
```

- [ ] **Step 6: param-tooltip テストを確認 (settings leaf 全てに doc 必須テスト)**

Run: `cd .worktrees/31-edges-fluctuation && bun test src/pose-particles/ui/param-tooltip.test.ts`
Expected: PASS

(`settingsLeafPaths(makeDefaultSettings())` が新パスを含み、doc が登録されていることを確認。)

- [ ] **Step 7: SettingsPanel に Wave / Rewire サブフォルダ追加**

`src/pose-particles/ui/SettingsPanel.ts:89-93` 周辺を:

```typescript
    const edges = particles.addFolder("Edges (sub-render)");
    edges.add(settings.edges, "enabled").name("enabled").onChange(() => this.applyActivation());
    edges.add(settings.edges, "anchorCount", 16, 256, 1).name("anchor count");
    edges.add(settings.edges, "kNeighbors", 1, 5, 1).name("k neighbours");
    edges.add(settings.edges, "alpha", 0, 1, 0.01).name("opacity");

    const edgeWave = edges.addFolder("Wave (noise displacement)");
    edgeWave.add(settings.edges.wave, "enabled").name("enabled");
    edgeWave.add(settings.edges.wave, "subdivisions", 2, 16, 1).name("subdivisions");
    edgeWave.add(settings.edges.wave, "amplitude", 0, 0.5, 0.005).name("amplitude (m)");
    edgeWave.add(settings.edges.wave, "audioBoost", 0, 3, 0.05).name("bass boost");
    edgeWave.add(settings.edges.wave, "scale", 0.5, 10, 0.1).name("noise scale");
    edgeWave.add(settings.edges.wave, "speed", 0, 3, 0.05).name("noise speed");

    const edgeRewire = edges.addFolder("Rewire (periodic shuffle)");
    edgeRewire.add(settings.edges.rewire, "enabled").name("enabled");
    edgeRewire.add(settings.edges.rewire, "interval", 0, 5, 0.05).name("interval (s)");
    edgeRewire.add(settings.edges.rewire, "fraction", 0, 1, 0.05).name("fraction");
    edgeRewire.add(settings.edges.rewire, "fadeDuration", 0.05, 1, 0.01).name("fade (s)");
    edgeRewire.add(settings.edges.rewire, "candidatePool", 1, 10, 1).name("candidate pool");
```

`GATED_GROUPS` の `edges` 配下チェックは既存の applyActivation 実装で wave/rewire サブフォルダも `edges.enabled` の従属下に入る (再帰)。**確認のため param-relevance テストで担保するが、もし `applyActivation` がトップレベル `enabled` の影響を子フォルダに再帰させていなければ、ここで再帰させる修正を追加する。**

- [ ] **Step 8: 全体テスト**

Run: `cd .worktrees/31-edges-fluctuation && bun test`
Expected: PASS (215 tests)

- [ ] **Step 9: 型チェック (tsc)**

Run: `cd .worktrees/31-edges-fluctuation && bunx tsc --noEmit`
Expected: エラーなし

- [ ] **Step 10: ビルド確認**

Run: `cd .worktrees/31-edges-fluctuation && bun run build 2>&1 | tail -20` (もし build スクリプトが定義されていれば。なければスキップして次へ)
Expected: 成功

- [ ] **Step 11: Commit**

```bash
cd .worktrees/31-edges-fluctuation
git add src/pose-particles/ui/param-docs.ts src/pose-particles/ui/param-relevance.ts src/pose-particles/ui/param-relevance.test.ts src/pose-particles/ui/SettingsPanel.ts
git commit -m "#31 feat: SettingsPanel に Edges Wave / Rewire サブフォルダを追加"
```

---

## Task 7: マージ前最終チェック

- [ ] **Step 1: 全テストを再度実行 (回帰確認)**

Run: `cd .worktrees/31-edges-fluctuation && bun test`
Expected: 215 tests pass, 0 fail

- [ ] **Step 2: 型チェック**

Run: `cd .worktrees/31-edges-fluctuation && bunx tsc --noEmit`
Expected: エラーなし

- [ ] **Step 3: 最新 main との rebase 確認**

```bash
cd .worktrees/31-edges-fluctuation
git fetch origin main
git merge-base --is-ancestor origin/main HEAD && echo "up-to-date" || echo "needs rebase"
```

`needs rebase` の場合は `git rebase origin/main` し、コンフリクト解消後にテスト再実行。

- [ ] **Step 4: PR 作成**

```bash
cd .worktrees/31-edges-fluctuation
git push -u origin feature/31-edges-fluctuation
gh pr create --repo mishi5/three-art --base main --head feature/31-edges-fluctuation \
  --title "#31 feat: Edges に揺らぎ (波打ち + リワイヤ) を追加" \
  --body "$(cat <<'EOF'
Issue #31

## 変更概要

- `settings.edges.wave` を追加: subdivisions / amplitude / audioBoost / scale / speed
- `settings.edges.rewire` を追加: interval / fraction / fadeDuration / candidatePool
- `EdgeOverlay` を細分化レンダリングに再構成し、Perlin (value noise) で波打ち、kNN edge を一定間隔で部分入れ替え + クロスフェード
- SettingsPanel に Wave / Rewire サブフォルダを追加
- param-docs / param-relevance も追記

## 動作確認

```
cd /Users/shun/dev/three-art/.worktrees/31-edges-fluctuation && bun run dev
```

その後 SettingsPanel の Edges を ON → Wave / Rewire の各 enabled を切り替えて挙動を確認。

## テスト

`bun test` 全 215 テストパス済み。

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

(PR 本文に `Closes #31` を書かないこと。)

- [ ] **Step 5: ユーザに動作確認を促す**

メッセージ例:

> Issue #31 の実装が完了し、PR を作成しました。以下のコマンドで動作確認をお願いします:
>
> ```
> cd /Users/shun/dev/three-art/.worktrees/31-edges-fluctuation && bun run dev
> ```
>
> 確認ポイント:
> - bones/cube/sphere モードで `Edges > enabled = ON`
> - `Wave > enabled = ON` で `amplitude` / `audioBoost` を上げるとラインが揺らぐ
> - `Rewire > enabled = ON` で `interval` 秒ごとにエッジ構成がフェードして入れ替わる
> - 両 OFF のときの見た目が main と同じ

確認 OK が出てからマージへ進む。

---

## Self-Review Notes

- **Backward compat**: Task 3 の互換テストで「`wave.enabled=false && rewire.enabled=false` で現状と同じ kNN セグメント描画 (端点が全てアンカーに一致)」を保証している。さらに Task 1 で defaults が両方 false なので、既存設定のロード後挙動は変わらない。
- **localStorage migrate**: `deepMerge` が未知キーをそのまま保持するため、旧 snapshot (wave/rewire 無し) でも `makeDefaultSettings()` 側の値で補完される。追加の migrate 関数は不要。
- **Performance**: 最悪 N=256, k=5, S=16 で 256*5*16*2*3 = 122880 float 書込/frame。CPU 側のループは N*N kNN + edge*S noise eval (256*5*16 = 20480 noise 呼び出し)。value-noise は ~10 ops/呼び出し → ~200K ops/frame 程度で許容。
- **Color attribute**: `LineBasicMaterial({ vertexColors: true, transparent: true, blending: AdditiveBlending })` で頂点カラー (RGB) を additive ブレンドのソース係数として使い、フェード alpha を擬似的に再現する。実 alpha channel は使わず、各エッジに対し (fade, fade, fade) を書き込む。
- **GATED_GROUPS と applyActivation の再帰**: 既存 SettingsPanel が `edges` フォルダ配下のすべての controllers を `edges.enabled` 連動で disable する実装になっているか Task 6 Step 7 内で確認、必要なら一行修正する。
