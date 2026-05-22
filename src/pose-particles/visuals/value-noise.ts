/**
 * 決定論的 3D value noise (Issue #31)。
 *
 * 整数格子点に hash でランダム値 (-1..1) を割り当て、入力を 3 軸方向に
 * smoothstep 補間する。Perlin より軽く、テクスチャ不要で CPU から呼べる。
 * EdgeOverlay の波打ち変位 (noise3D ベース) で使用する。
 */

/** 32bit 整数ハッシュ → -1..1 の浮動小数。 */
function hash(ix: number, iy: number, iz: number): number {
  let h = (Math.imul(ix | 0, 374761393) >>> 0)
    + (Math.imul(iy | 0, 668265263) >>> 0)
    + (Math.imul(iz | 0, 1610612741) >>> 0);
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return (h / 0xffffffff) * 2 - 1;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * 3D value noise。値域は [-1, 1]。連続 (C0)。
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
