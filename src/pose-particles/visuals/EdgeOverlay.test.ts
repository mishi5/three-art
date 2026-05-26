import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { EdgeOverlay, bitReverse8 } from "./EdgeOverlay";
import { makeDefaultSettings } from "../settings";
import { applyTwist } from "./twist";
import { makeEmptyJoints, NUM_JOINTS, type AudioFeatures } from "../types";

function makeAudio(): AudioFeatures {
  return { volume: 0, bass: 0, mid: 0, treble: 0, fft: new Float32Array(0) };
}

describe("EdgeOverlay twist", () => {
  test("twist OFF with non-zero phaseSpeed: anchor positions stay constant over time", () => {
    const overlay = new EdgeOverlay();
    const settings = makeDefaultSettings();
    settings.edges.enabled = true;
    settings.edges.anchorCount = 16;
    settings.edges.kNeighbors = 1;
    settings.mode = "sphere";
    settings.outlier.boost = 1.0; // outlier wave を消す
    settings.twist.enabled = false;
    settings.twist.phaseSpeed = 1.0; // OFFなら無視されるべき
    const joints = makeEmptyJoints();
    const center = new Float32Array([0, 0, 0]);
    const audio = makeAudio();

    overlay.update(joints, center, audio, settings, 1.0);
    const [x1, y1, z1] = overlay.getAnchorPosition(1);
    overlay.update(joints, center, audio, settings, 5.0);
    const [x2, y2, z2] = overlay.getAnchorPosition(1);

    expect(x2).toBeCloseTo(x1, 6);
    expect(y2).toBeCloseTo(y1, 6);
    expect(z2).toBeCloseTo(z1, 6);
  });

  test("twist ON: anchor positions rotate by applyTwist with same params as PointCloud", () => {
    const overlay = new EdgeOverlay();
    const settings = makeDefaultSettings();
    settings.edges.enabled = true;
    settings.edges.anchorCount = 16;
    settings.edges.kNeighbors = 1;
    settings.mode = "sphere";
    settings.outlier.boost = 1.0;
    const joints = makeEmptyJoints();
    const center = new Float32Array([0, 0, 0]);
    const audio = makeAudio();

    // 1) twist OFF で「素」の位置を取る
    settings.twist.enabled = false;
    settings.twist.phaseSpeed = 0;
    overlay.update(joints, center, audio, settings, 0.5);
    const [bx, by, bz] = overlay.getAnchorPosition(1);

    // 2) twist ON で同じ時刻に update → applyTwist の結果と一致するはず
    settings.twist.enabled = true;
    settings.twist.axis = "y";
    settings.twist.strength = 2.0;
    settings.twist.bassDrive = 0;
    settings.twist.phaseSpeed = 0;
    overlay.update(joints, center, audio, settings, 0.5);
    const [tx, ty, tz] = overlay.getAnchorPosition(1);
    const [ex, ey, ez] = applyTwist(bx, by, bz, "y", 2.0, 0);

    expect(tx).toBeCloseTo(ex, 5);
    expect(ty).toBeCloseTo(ey, 5);
    expect(tz).toBeCloseTo(ez, 5);
    // OFF状態と異なることも確認（テストが空回りしていない保証）
    const moved = Math.abs(tx - bx) + Math.abs(tz - bz);
    expect(moved).toBeGreaterThan(1e-4);
  });

  test("twist ON with phaseSpeed: position evolves over time", () => {
    const overlay = new EdgeOverlay();
    const settings = makeDefaultSettings();
    settings.edges.enabled = true;
    settings.edges.anchorCount = 16;
    settings.edges.kNeighbors = 1;
    settings.mode = "sphere";
    settings.outlier.boost = 1.0;
    settings.twist.enabled = true;
    settings.twist.axis = "y";
    settings.twist.strength = 0; // strength=0 でも phase で回るべき
    settings.twist.bassDrive = 0;
    settings.twist.phaseSpeed = 1.0;
    const joints = makeEmptyJoints();
    const center = new Float32Array([0, 0, 0]);
    const audio = makeAudio();

    overlay.update(joints, center, audio, settings, 0.0);
    const [x0, , z0] = overlay.getAnchorPosition(1);
    overlay.update(joints, center, audio, settings, Math.PI / 2);
    const [x1, , z1] = overlay.getAnchorPosition(1);

    // (x, z) が axis=y で 90deg 回るので、x→-z, z→x になる
    expect(x1).toBeCloseTo(-z0, 5);
    expect(z1).toBeCloseTo(x0, 5);
  });
});

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

describe("EdgeOverlay image mode", () => {
  test("mode=image では edges.enabled=true でも描画されない", () => {
    const overlay = new EdgeOverlay();
    const settings = makeDefaultSettings();
    settings.edges.enabled = true;
    settings.edges.anchorCount = 16;
    settings.mode = "image";
    const joints = makeEmptyJoints();
    const center = new Float32Array([0, 0, 0]);
    const audio = makeAudio();

    overlay.update(joints, center, audio, settings, 0.5);

    expect(overlay.object3D.visible).toBe(false);
  });
});

// ============================================================
// Issue #31: 揺らぎ (wave / rewire) のテスト
// ============================================================

/** anchorCount 個の anchor 位置を取得。 */
function listAnchors(overlay: EdgeOverlay, n: number): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  for (let i = 0; i < n; i++) out.push(overlay.getAnchorPosition(i));
  return out;
}

/** 座標 (x, y, z) が anchors のどれかに一致するか。 */
function isAnchor(anchors: Array<[number, number, number]>, x: number, y: number, z: number, tol = 1e-5): boolean {
  return anchors.some(([ax, ay, az]) => Math.abs(ax - x) < tol && Math.abs(ay - y) < tol && Math.abs(az - z) < tol);
}

describe("EdgeOverlay backward compatibility (Issue #31)", () => {
  test("wave/rewire OFF: 各セグメント端点が anchor のどれかに一致", () => {
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
    expect(count).toBeGreaterThan(0);
    const pos = geom.attributes.position!.array as Float32Array;
    const anchors = listAnchors(overlay, 16);
    for (let s = 0; s < count; s += 2) {
      const i0 = s * 3;
      const i1 = (s + 1) * 3;
      expect(isAnchor(anchors, pos[i0]!, pos[i0 + 1]!, pos[i0 + 2]!)).toBe(true);
      expect(isAnchor(anchors, pos[i1]!, pos[i1 + 1]!, pos[i1 + 2]!)).toBe(true);
    }
  });

  test("wave/rewire OFF: color attribute が全頂点 1 (現状の opacity と等価)", () => {
    const overlay = new EdgeOverlay();
    const settings = makeDefaultSettings();
    settings.edges.enabled = true;
    settings.edges.anchorCount = 16;
    settings.mode = "sphere";
    settings.outlier.boost = 1.0;
    settings.twist.enabled = false;
    const joints = makeEmptyJoints();
    const center = new Float32Array([0, 0, 0]);
    const audio = makeAudio();
    overlay.update(joints, center, audio, settings, 0);
    const geom = overlay.object3D.geometry as THREE.BufferGeometry;
    const colors = geom.attributes.color!.array as Float32Array;
    const count = geom.drawRange.count;
    for (let i = 0; i < count; i++) {
      expect(colors[i * 3]!).toBeCloseTo(1, 5);
    }
  });
});

describe("EdgeOverlay wave (Issue #31)", () => {
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

  test("wave ON でも各エッジ連鎖の両端は anchor と一致 (端点は揺らがない)", () => {
    const { overlay, settings, joints, center, audio } = setupWave();
    overlay.update(joints, center, audio, settings, 0);
    const geom = overlay.object3D.geometry as THREE.BufferGeometry;
    const pos = geom.attributes.position!.array as Float32Array;
    const count = geom.drawRange.count;
    const S = settings.edges.wave.subdivisions;
    expect(count % (S * 2)).toBe(0);
    const numEdges = count / (S * 2);
    const anchors = listAnchors(overlay, 16);
    for (let e = 0; e < numEdges; e++) {
      const startIdx = e * S * 2 * 3;
      const endIdx = (e * S * 2 + S * 2 - 1) * 3;
      expect(isAnchor(anchors, pos[startIdx]!, pos[startIdx + 1]!, pos[startIdx + 2]!)).toBe(true);
      expect(isAnchor(anchors, pos[endIdx]!, pos[endIdx + 1]!, pos[endIdx + 2]!)).toBe(true);
    }
  });

  test("amplitude=0 → 全頂点が両端の直線上に乗る (波打ちなし)", () => {
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
      const dx = bx - ax, dy = by - ay, dz = bz - az;
      for (let s = 0; s < S * 2; s++) {
        const idx = (e * S * 2 + s) * 3;
        const rx = pos[idx]! - ax, ry = pos[idx + 1]! - ay, rz = pos[idx + 2]! - az;
        const cx = ry * dz - rz * dy;
        const cy = rz * dx - rx * dz;
        const cz = rx * dy - ry * dx;
        expect(Math.sqrt(cx * cx + cy * cy + cz * cz)).toBeLessThan(1e-4);
      }
    }
  });

  test("amplitude>0 → 中央近傍の頂点が直線中点から有意に外れる", () => {
    const { overlay, settings, joints, center, audio } = setupWave();
    settings.edges.wave.amplitude = 0.1;
    overlay.update(joints, center, audio, settings, 0);
    const geom = overlay.object3D.geometry as THREE.BufferGeometry;
    const pos = geom.attributes.position!.array as Float32Array;
    const count = geom.drawRange.count;
    const S = settings.edges.wave.subdivisions;
    const numEdges = count / (S * 2);
    expect(numEdges).toBeGreaterThan(0);
    let maxDist = 0;
    for (let e = 0; e < numEdges; e++) {
      const startIdx = e * S * 2 * 3;
      const endIdx = (e * S * 2 + S * 2 - 1) * 3;
      const ax = pos[startIdx]!, ay = pos[startIdx + 1]!, az = pos[startIdx + 2]!;
      const bx = pos[endIdx]!, by = pos[endIdx + 1]!, bz = pos[endIdx + 2]!;
      const midIdx = (e * S * 2 + S) * 3; // 連鎖中央のサブ頂点
      const px = pos[midIdx]!, py = pos[midIdx + 1]!, pz = pos[midIdx + 2]!;
      const mx = (ax + bx) * 0.5, my = (ay + by) * 0.5, mz = (az + bz) * 0.5;
      const d = Math.hypot(px - mx, py - my, pz - mz);
      if (d > maxDist) maxDist = d;
    }
    expect(maxDist).toBeGreaterThan(0.005);
  });

  test("speed>0 → 時刻で中間頂点位置が変化する", () => {
    const { overlay, settings, joints, center, audio } = setupWave();
    settings.edges.wave.speed = 1.0;
    overlay.update(joints, center, audio, settings, 0);
    const pos0 = Float32Array.from(
      (overlay.object3D.geometry.attributes.position!.array as Float32Array).slice(0, 96 * 3),
    );
    overlay.update(joints, center, audio, settings, 2.0);
    const pos1 = (overlay.object3D.geometry.attributes.position!.array as Float32Array).slice(0, 96 * 3);
    let diff = 0;
    for (let i = 0; i < pos0.length; i++) diff += Math.abs(pos0[i]! - pos1[i]!);
    expect(diff).toBeGreaterThan(1e-3);
  });

  test("audioBoost>0 で bass を上げると変位が大きくなる", () => {
    const { overlay, settings, joints, center, audio } = setupWave();
    settings.edges.wave.amplitude = 0.05;
    settings.edges.wave.audioBoost = 2.0;
    const audioLow: AudioFeatures = { ...audio, bass: 0 };
    const audioHigh: AudioFeatures = { ...audio, bass: 1 };
    overlay.update(joints, center, audioLow, settings, 0);
    const posLow = Float32Array.from(
      (overlay.object3D.geometry.attributes.position!.array as Float32Array).slice(0, 256 * 3),
    );
    overlay.update(joints, center, audioHigh, settings, 0);
    const posHigh = (overlay.object3D.geometry.attributes.position!.array as Float32Array).slice(0, 256 * 3);

    const S = settings.edges.wave.subdivisions;
    let sumLow = 0, sumHigh = 0;
    const numEdges = 16; // anchorCount=16, k=1 で必ず >=16 本引かれる
    for (let e = 0; e < numEdges; e++) {
      const startIdx = e * S * 2 * 3;
      const endIdx = (e * S * 2 + S * 2 - 1) * 3;
      const midIdx = (e * S * 2 + S) * 3;
      const mxL = (posLow[startIdx]! + posLow[endIdx]!) * 0.5;
      const myL = (posLow[startIdx + 1]! + posLow[endIdx + 1]!) * 0.5;
      const mzL = (posLow[startIdx + 2]! + posLow[endIdx + 2]!) * 0.5;
      sumLow += Math.hypot(posLow[midIdx]! - mxL, posLow[midIdx + 1]! - myL, posLow[midIdx + 2]! - mzL);
      const mxH = (posHigh[startIdx]! + posHigh[endIdx]!) * 0.5;
      const myH = (posHigh[startIdx + 1]! + posHigh[endIdx + 1]!) * 0.5;
      const mzH = (posHigh[startIdx + 2]! + posHigh[endIdx + 2]!) * 0.5;
      sumHigh += Math.hypot(posHigh[midIdx]! - mxH, posHigh[midIdx + 1]! - myH, posHigh[midIdx + 2]! - mzH);
    }
    expect(sumHigh).toBeGreaterThan(sumLow * 1.5);
  });
});

describe("EdgeOverlay rewire (Issue #31)", () => {
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

  function edgeKeys(overlay: EdgeOverlay): Set<string> {
    return new Set(overlay.debugListEdges().map(([a, b]) => `${Math.min(a, b)}-${Math.max(a, b)}`));
  }

  test("rewire OFF: 何度 update してもエッジ集合は不変", () => {
    const { overlay, settings, joints, center, audio } = setup(false, 1.5, 0.3, 0.4);
    overlay.update(joints, center, audio, settings, 0);
    const before = edgeKeys(overlay);
    for (let i = 1; i <= 20; i++) overlay.update(joints, center, audio, settings, i * 0.1);
    const after = edgeKeys(overlay);
    expect([...after].sort()).toEqual([...before].sort());
  });

  test("rewire interval=0: リワイヤは発火しない", () => {
    const { overlay, settings, joints, center, audio } = setup(true, 0, 0.5, 0.4);
    overlay.update(joints, center, audio, settings, 0);
    const before = edgeKeys(overlay);
    overlay.update(joints, center, audio, settings, 5);
    overlay.update(joints, center, audio, settings, 10);
    const after = edgeKeys(overlay);
    expect([...after].sort()).toEqual([...before].sort());
  });

  test("interval 経過後、エッジ集合が部分的に新しいものに置換される", () => {
    const { overlay, settings, joints, center, audio } = setup(true, 0.5, 0.5, 0.2);
    overlay.update(joints, center, audio, settings, 0);
    const before = edgeKeys(overlay);
    overlay.update(joints, center, audio, settings, 0.6); // interval 経過 → rewire
    overlay.update(joints, center, audio, settings, 1.0); // fade 完了
    const after = edgeKeys(overlay);
    let diff = 0;
    for (const k of after) if (!before.has(k)) diff++;
    expect(diff).toBeGreaterThan(0);
  });

  test("fade-in 中: 新エッジは color 低、旧エッジ (fade-out) は color 残存", () => {
    const { overlay, settings, joints, center, audio } = setup(true, 0.5, 1.0, 0.4);
    overlay.update(joints, center, audio, settings, 0);
    overlay.update(joints, center, audio, settings, 0.6); // rewire 発火 (lastRewireT=0.6)
    overlay.update(joints, center, audio, settings, 0.7); // fadeDuration=0.4 の 0.1/0.4 進行
    const colors = overlay.object3D.geometry.attributes.color!.array as Float32Array;
    const count = overlay.object3D.geometry.drawRange.count;
    expect(count).toBeGreaterThan(0);
    let minColor = 1.0;
    let maxColor = 0.0;
    for (let i = 0; i < count; i++) {
      const c = colors[i * 3]!;
      if (c < minColor) minColor = c;
      if (c > maxColor) maxColor = c;
    }
    expect(minColor).toBeLessThan(0.5);  // 新エッジはまだ薄い (~0.25)
    expect(maxColor).toBeGreaterThan(0.5); // 旧エッジ (fade-out) はまだ濃い (~0.75)
  });

  test("fade 完了後、すべてのエッジ color が 1 に戻る", () => {
    const { overlay, settings, joints, center, audio } = setup(true, 0.5, 1.0, 0.2);
    overlay.update(joints, center, audio, settings, 0);
    overlay.update(joints, center, audio, settings, 0.51); // rewire 発火
    overlay.update(joints, center, audio, settings, 1.5);  // > 0.51 + fadeDuration
    const colors = overlay.object3D.geometry.attributes.color!.array as Float32Array;
    const count = overlay.object3D.geometry.drawRange.count;
    for (let i = 0; i < count; i++) {
      expect(colors[i * 3]!).toBeCloseTo(1, 5);
    }
  });
});

describe("EdgeOverlay anchor low-discrepancy permutation (Issue #48)", () => {
  test("bitReverse8: 既知値", () => {
    expect(bitReverse8(0)).toBe(0);
    expect(bitReverse8(1)).toBe(128); // 00000001 → 10000000
    expect(bitReverse8(2)).toBe(64);  // 00000010 → 01000000
    expect(bitReverse8(3)).toBe(192); // 00000011 → 11000000
    expect(bitReverse8(128)).toBe(1);
    expect(bitReverse8(255)).toBe(255);
  });

  test("bitReverse8: [0,256) の bijection", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 256; i++) {
      const p = bitReverse8(i);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThan(256);
      seen.add(p);
    }
    expect(seen.size).toBe(256);
  });

  test("sphere モード: anchorCount=4 で先頭 4 anchor が球面上の y 方向に広く分散する", () => {
    // 修正前は Fibonacci の i=0..3 が y≈{1, 0.992, 0.984, 0.976} で max-min ≈ 0.024
    // 修正後は perm 適用で y が両極と赤道付近に散らばり max-min > 1.0 を満たす
    const overlay = new EdgeOverlay();
    const settings = makeDefaultSettings();
    settings.edges.enabled = true;
    settings.edges.anchorCount = 4;
    settings.edges.kNeighbors = 1;
    settings.mode = "sphere";
    settings.shape.radius = 1.0;
    settings.shape.bassPulse = 0;
    settings.outlier.boost = 1.0;
    settings.twist.enabled = false;
    settings.twist.phaseSpeed = 0;
    const joints = makeEmptyJoints();
    const center = new Float32Array([0, 0, 0]);
    overlay.update(joints, center, makeAudio(), settings, 0);

    let minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < 4; i++) {
      const [, y] = overlay.getAnchorPosition(i);
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    expect(maxY - minY).toBeGreaterThan(1.0);
  });

  test("bones モード: anchorCount=4 で先頭 4 anchor のジョイント割当が単純な 0..3 ではない", () => {
    // joint i を y=i に置き、anchor の y を見て使われた joint index を逆引きする
    // (bones offset の gaussian は ~0.08 で |dy|<0.3、なので round(anchor.y) が joint index)
    // 修正前: joints {0,1,2,3} → max(joint) = 3
    // 修正後: perm 適用で下半身 joint (>= 8) も含まれる → max(joint) >= 8
    const overlay = new EdgeOverlay();
    const settings = makeDefaultSettings();
    settings.edges.enabled = true;
    settings.edges.anchorCount = 4;
    settings.edges.kNeighbors = 1;
    settings.mode = "bones";
    settings.pointCloud.bassExpansion = 0;
    settings.outlier.boost = 1.0;
    settings.twist.enabled = false;
    settings.twist.phaseSpeed = 0;
    const joints = makeEmptyJoints();
    for (let j = 0; j < NUM_JOINTS; j++) {
      joints[j * 3] = 0;
      joints[j * 3 + 1] = j; // distinct y per joint
      joints[j * 3 + 2] = 0;
    }
    const center = new Float32Array([0, 0, 0]);
    overlay.update(joints, center, makeAudio(), settings, 0);

    const jointsUsed = new Set<number>();
    let maxJ = -1;
    for (let i = 0; i < 4; i++) {
      const [, y] = overlay.getAnchorPosition(i);
      const j = Math.round(y);
      jointsUsed.add(j);
      if (j > maxJ) maxJ = j;
    }
    expect(jointsUsed.size).toBe(4); // 4 anchor が異なる joint を指す (重複なし)
    expect(maxJ).toBeGreaterThanOrEqual(8); // 下半身 joint が含まれる
  });

  test("sphere モード: anchorCount=MAX(256) で全 anchor の y 集合が Fibonacci 球と同じ multiset", () => {
    // permutation は bijection なので全 anchor を使う場合は順序のみ違って点群は同じ
    const overlay = new EdgeOverlay();
    const settings = makeDefaultSettings();
    settings.edges.enabled = true;
    settings.edges.anchorCount = 256;
    settings.edges.kNeighbors = 1;
    settings.mode = "sphere";
    settings.shape.radius = 1.0;
    settings.shape.bassPulse = 0;
    settings.outlier.boost = 1.0;
    settings.twist.enabled = false;
    settings.twist.phaseSpeed = 0;
    const joints = makeEmptyJoints();
    const center = new Float32Array([0, 0, 0]);
    overlay.update(joints, center, makeAudio(), settings, 0);

    const actual: number[] = [];
    for (let i = 0; i < 256; i++) actual.push(overlay.getAnchorPosition(i)[1]);
    actual.sort((a, b) => a - b);
    const expected: number[] = [];
    for (let k = 0; k < 256; k++) expected.push(1 - (k / 255) * 2);
    expected.sort((a, b) => a - b);
    for (let k = 0; k < 256; k++) expect(actual[k]!).toBeCloseTo(expected[k]!, 5);
  });

  test("cube モード: anchorCount=4 でも anchor 位置が一様乱数のまま (regression)", () => {
    // cube/polyhedron は anchorPolyR の独立乱数で問題なし → 触らないことの確認
    const overlay = new EdgeOverlay();
    const settings = makeDefaultSettings();
    settings.edges.enabled = true;
    settings.edges.anchorCount = 4;
    settings.edges.kNeighbors = 1;
    settings.mode = "cube";
    settings.shape.radius = 1.0;
    settings.shape.bassPulse = 0;
    settings.outlier.boost = 1.0;
    settings.twist.enabled = false;
    settings.twist.phaseSpeed = 0;
    const joints = makeEmptyJoints();
    const center = new Float32Array([0, 0, 0]);
    overlay.update(joints, center, makeAudio(), settings, 0);

    const positions: Array<[number, number, number]> = [];
    for (let i = 0; i < 4; i++) positions.push(overlay.getAnchorPosition(i));
    // 4 点が同一面に集まると Var が低い。少なくとも 1 軸で広がりがあること
    const ys = positions.map((p) => p[1]);
    const maxY = Math.max(...ys), minY = Math.min(...ys);
    const xs = positions.map((p) => p[0]);
    const maxX = Math.max(...xs), minX = Math.min(...xs);
    const zs = positions.map((p) => p[2]);
    const maxZ = Math.max(...zs), minZ = Math.min(...zs);
    expect(Math.max(maxX - minX, maxY - minY, maxZ - minZ)).toBeGreaterThan(0.5);
  });
});
