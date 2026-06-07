/**
 * 外接球半径 1 の単位正多面体表面上の点を一様サンプリングする (CPU 実装、Issue #40)。
 *
 * PointCloud.ts vertex shader の sampleTetrahedron / sampleCube /
 * sampleOctahedron / sampleDodecahedron と同じロジックの TypeScript 移植。
 * EdgeOverlay などの CPU で anchor を打つコードが GLSL と同じ表面分布を得るために使う。
 *
 * 戻り値の各成分はすべて [-1, 1] 範囲内。|pos| <= 1 (外接球半径)。
 */
import type { PolyhedronFaces } from "./render-mode";

const INV_SQRT3 = 1 / Math.sqrt(3);
const TWO_PI = 2 * Math.PI;

// Regular dodecahedron with circumradius 1 の幾何定数 (GLSL 側と完全一致)
const DODECA_R_IN = 0.79465447;
const DODECA_RHO = 0.60706548;
const ICOSA_A = 0.52573;
const ICOSA_B = 0.85065;

const DODECA_FACE_NORMALS: ReadonlyArray<readonly [number, number, number]> = [
  [0,  ICOSA_A,  ICOSA_B],
  [0,  ICOSA_A, -ICOSA_B],
  [0, -ICOSA_A,  ICOSA_B],
  [0, -ICOSA_A, -ICOSA_B],
  [ ICOSA_A,  ICOSA_B, 0],
  [ ICOSA_A, -ICOSA_B, 0],
  [-ICOSA_A,  ICOSA_B, 0],
  [-ICOSA_A, -ICOSA_B, 0],
  [ ICOSA_B, 0,  ICOSA_A],
  [ ICOSA_B, 0, -ICOSA_A],
  [-ICOSA_B, 0,  ICOSA_A],
  [-ICOSA_B, 0, -ICOSA_A],
];

export type Vec3 = [number, number, number];

/** 三角形 (A,B,C) 内一様サンプリング (重心座標)。r0,r1 ∈ [0,1)。 */
function sampleTri(
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
  r0: number, r1: number,
): Vec3 {
  const s = Math.sqrt(r0);
  const wA = 1 - s;
  const wB = s * (1 - r1);
  const wC = s * r1;
  return [
    wA * ax + wB * bx + wC * cx,
    wA * ay + wB * by + wC * cy,
    wA * az + wB * bz + wC * cz,
  ];
}

function sampleTetrahedron(faceHash: number, r0: number, r1: number): Vec3 {
  const v0x =  INV_SQRT3, v0y =  INV_SQRT3, v0z =  INV_SQRT3;
  const v1x =  INV_SQRT3, v1y = -INV_SQRT3, v1z = -INV_SQRT3;
  const v2x = -INV_SQRT3, v2y =  INV_SQRT3, v2z = -INV_SQRT3;
  const v3x = -INV_SQRT3, v3y = -INV_SQRT3, v3z =  INV_SQRT3;
  if (faceHash < 0.25) return sampleTri(v0x, v0y, v0z, v1x, v1y, v1z, v2x, v2y, v2z, r0, r1);
  if (faceHash < 0.50) return sampleTri(v0x, v0y, v0z, v2x, v2y, v2z, v3x, v3y, v3z, r0, r1);
  if (faceHash < 0.75) return sampleTri(v0x, v0y, v0z, v3x, v3y, v3z, v1x, v1y, v1z, r0, r1);
  return sampleTri(v1x, v1y, v1z, v3x, v3y, v3z, v2x, v2y, v2z, r0, r1);
}

function sampleCube(faceHash: number, r0: number, r1: number): Vec3 {
  const u = (r0 - 0.5) * 2;
  const v = (r1 - 0.5) * 2;
  let px: number, py: number, pz: number;
  if (faceHash < 0.16667)      { px =  1; py = u; pz = v; }
  else if (faceHash < 0.33333) { px = -1; py = u; pz = v; }
  else if (faceHash < 0.50000) { px = u; py =  1; pz = v; }
  else if (faceHash < 0.66667) { px = u; py = -1; pz = v; }
  else if (faceHash < 0.83333) { px = u; py = v; pz =  1; }
  else                         { px = u; py = v; pz = -1; }
  return [px * INV_SQRT3, py * INV_SQRT3, pz * INV_SQRT3];
}

function sampleOctahedron(faceHash: number, r0: number, r1: number): Vec3 {
  // 6 頂点 (±x, ±y, ±z) はすでに外接球半径 1
  if (faceHash < 0.125) return sampleTri( 1, 0, 0,  0, 1, 0,  0, 0, 1, r0, r1);
  if (faceHash < 0.250) return sampleTri( 1, 0, 0,  0, 0, 1,  0,-1, 0, r0, r1);
  if (faceHash < 0.375) return sampleTri( 1, 0, 0,  0,-1, 0,  0, 0,-1, r0, r1);
  if (faceHash < 0.500) return sampleTri( 1, 0, 0,  0, 0,-1,  0, 1, 0, r0, r1);
  if (faceHash < 0.625) return sampleTri(-1, 0, 0,  0, 0, 1,  0, 1, 0, r0, r1);
  if (faceHash < 0.750) return sampleTri(-1, 0, 0,  0,-1, 0,  0, 0, 1, r0, r1);
  if (faceHash < 0.875) return sampleTri(-1, 0, 0,  0, 0,-1,  0,-1, 0, r0, r1);
  return                       sampleTri(-1, 0, 0,  0, 1, 0,  0, 0,-1, r0, r1);
}

function sampleDodecahedron(faceHash: number, r0: number, r1: number, r2: number): Vec3 {
  let faceIdx = Math.floor(faceHash * 12);
  if (faceIdx > 11) faceIdx = 11;
  const n = DODECA_FACE_NORMALS[faceIdx]!;
  const nx = n[0], ny = n[1], nz = n[2];

  // 面平面の orthonormal basis を法線から構成 (helper × n を normalize、n × u を取る)
  const hx = Math.abs(ny) < 0.99 ? 0 : 1;
  const hy = Math.abs(ny) < 0.99 ? 1 : 0;
  const hz = 0;
  // u = normalize(helper × n)
  const uxRaw = hy * nz - hz * ny;
  const uyRaw = hz * nx - hx * nz;
  const uzRaw = hx * ny - hy * nx;
  const uLen = Math.sqrt(uxRaw * uxRaw + uyRaw * uyRaw + uzRaw * uzRaw);
  const ux = uxRaw / uLen, uy = uyRaw / uLen, uz = uzRaw / uLen;
  // v = n × u (n と u は直交、両方単位 → v も単位)
  const vx = ny * uz - nz * uy;
  const vy = nz * ux - nx * uz;
  const vz = nx * uy - ny * ux;

  // 面中心
  const cx = nx * DODECA_R_IN;
  const cy = ny * DODECA_R_IN;
  const cz = nz * DODECA_R_IN;

  // fan 5 三角形のうち 1 つを r2 で選択、その三角形 (center, ringK, ringK+1) で重心
  let k = Math.floor(r2 * 5);
  if (k > 4) k = 4;
  const a0 = k * (TWO_PI / 5);
  const a1 = (k + 1) * (TWO_PI / 5);
  const c0 = Math.cos(a0), s0 = Math.sin(a0);
  const c1 = Math.cos(a1), s1 = Math.sin(a1);
  const v0x = cx + DODECA_RHO * (c0 * ux + s0 * vx);
  const v0y = cy + DODECA_RHO * (c0 * uy + s0 * vy);
  const v0z = cz + DODECA_RHO * (c0 * uz + s0 * vz);
  const v1x = cx + DODECA_RHO * (c1 * ux + s1 * vx);
  const v1y = cy + DODECA_RHO * (c1 * uy + s1 * vy);
  const v1z = cz + DODECA_RHO * (c1 * uz + s1 * vz);
  return sampleTri(cx, cy, cz, v0x, v0y, v0z, v1x, v1y, v1z, r0, r1);
}

/**
 * 外接球半径 1 の単位正多面体表面上の点を返す。faceHash / r0 / r1 / r2 はすべて [0,1)。
 * r2 は polyhedron=12 (dodecahedron) でのみ参照される。
 */
export function samplePolyhedronUnit(
  polyhedron: PolyhedronFaces,
  faceHash: number,
  r0: number,
  r1: number,
  r2: number,
): Vec3 {
  switch (polyhedron) {
    case 4:  return sampleTetrahedron(faceHash, r0, r1);
    case 6:  return sampleCube(faceHash, r0, r1);
    case 8:  return sampleOctahedron(faceHash, r0, r1);
    case 12: return sampleDodecahedron(faceHash, r0, r1, r2);
  }
}
