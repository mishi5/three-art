import { describe, expect, test } from "bun:test";
import { samplePolyhedronUnit } from "./polyhedron-anchors";
import type { PolyhedronFaces } from "./render-mode";

function norm(v: readonly [number, number, number]): number {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
}

// circumradius=1 の正多面体の inradius (中心 → 面距離)
// テトラ: 1/3 / 1 = 1/3
// 立方体: (1/sqrt(3)) (頂点が ±1/sqrt(3))
// 八面体: 1/sqrt(3)
// 十二面体: 0.79465447 (DODECA_R_IN)
const INRADIUS: Record<PolyhedronFaces, number> = {
  4:  1 / 3,
  6:  1 / Math.sqrt(3),
  8:  1 / Math.sqrt(3),
  12: 0.79465447,
};

const POLYHEDRA: PolyhedronFaces[] = [4, 6, 8, 12];

describe("samplePolyhedronUnit", () => {
  test.each(POLYHEDRA)("polyhedron=%i: 全サンプルが外接球半径 1 以内", (poly) => {
    let maxR = 0;
    for (let i = 0; i < 500; i++) {
      const faceHash = Math.random();
      const r0 = Math.random();
      const r1 = Math.random();
      const r2 = Math.random();
      const p = samplePolyhedronUnit(poly, faceHash, r0, r1, r2);
      const r = norm(p);
      maxR = Math.max(maxR, r);
      // 浮動小数のマージン
      expect(r).toBeLessThanOrEqual(1.0 + 1e-3);
    }
    // 頂点付近を引けば外接球に十分近づく (500 サンプルで 0.85 以上は出るはず)
    expect(maxR).toBeGreaterThan(0.85);
  });

  test.each(POLYHEDRA)("polyhedron=%i: 全サンプルが内接球半径以上 (面外に出ない)", (poly) => {
    let minR = Infinity;
    for (let i = 0; i < 500; i++) {
      const p = samplePolyhedronUnit(poly, Math.random(), Math.random(), Math.random(), Math.random());
      const r = norm(p);
      minR = Math.min(minR, r);
      expect(r).toBeGreaterThanOrEqual(INRADIUS[poly] - 1e-3);
    }
    // 面中心付近を引けば内接球に十分近づく
    expect(minR).toBeLessThan(INRADIUS[poly] + 0.05);
  });

  test.each(POLYHEDRA)("polyhedron=%i: 同入力で deterministic", (poly) => {
    const p1 = samplePolyhedronUnit(poly, 0.37, 0.42, 0.58, 0.91);
    const p2 = samplePolyhedronUnit(poly, 0.37, 0.42, 0.58, 0.91);
    expect(p1[0]).toBe(p2[0]);
    expect(p1[1]).toBe(p2[1]);
    expect(p1[2]).toBe(p2[2]);
  });

  test("polyhedron=6 (cube): 面 0 (+x) の点は x ≈ 1/sqrt(3)", () => {
    // faceHash = 0 → +x face、(r0=0.5, r1=0.5) → 面中心 = (1/√3, 0, 0)
    const p = samplePolyhedronUnit(6, 0, 0.5, 0.5, 0);
    expect(p[0]).toBeCloseTo(1 / Math.sqrt(3), 5);
    expect(p[1]).toBeCloseTo(0, 5);
    expect(p[2]).toBeCloseTo(0, 5);
  });

  test("polyhedron=8 (octa): 第一 octant の面中心は重心 = (1/3, 1/3, 1/3)", () => {
    // faceHash = 0 → (px, py, pz) face、(r0=0, r1=anything) → A=px=(1,0,0)
    // r0=1, r1=0 → s=1, wA=0, wB=1, wC=0 → B=(0,1,0)
    // r0=1, r1=1 → s=1, wA=0, wB=0, wC=1 → C=(0,0,1)
    // 面中心は (A+B+C)/3 だが重心一様サンプリングの「面中心相当」はパラメータ依存。
    // ここは「全 corner が正しい」ことだけ確認。
    expect(samplePolyhedronUnit(8, 0, 0, 0, 0)).toEqual([1, 0, 0]);
    expect(samplePolyhedronUnit(8, 0, 1, 0, 0)).toEqual([0, 1, 0]);
    expect(samplePolyhedronUnit(8, 0, 1, 1, 0)).toEqual([0, 0, 1]);
  });

  test("polyhedron=4 (tetra): 頂点 v0=(inv,inv,inv) が r0=0 で取れる", () => {
    const inv = 1 / Math.sqrt(3);
    // faceHash<0.25 → face (v0, v1, v2)、r0=0 → A=v0
    const p = samplePolyhedronUnit(4, 0, 0, 0, 0);
    expect(p[0]).toBeCloseTo(inv, 5);
    expect(p[1]).toBeCloseTo(inv, 5);
    expect(p[2]).toBeCloseTo(inv, 5);
  });
});
