export type TwistAxis = "x" | "y" | "z";

export const TWIST_AXES: ReadonlyArray<TwistAxis> = ["x", "y", "z"];

export interface TwistSettings {
  enabled: boolean;
  axis: TwistAxis;
  strength: number;
  bassDrive: number;
  phaseSpeed: number;
}

export function makeDefaultTwist(): TwistSettings {
  return {
    enabled: false,
    axis: "y",
    strength: 1.0,
    bassDrive: 0.0,
    phaseSpeed: 0.0,
  };
}

export function axisToInt(axis: TwistAxis): 0 | 1 | 2 {
  return axis === "x" ? 0 : axis === "y" ? 1 : 2;
}

export function effectiveTwistStrength(t: TwistSettings, bass: number): number {
  if (!t.enabled) return 0;
  return t.strength * (1 + bass * t.bassDrive);
}

export function twistPhase(t: TwistSettings, timeSec: number): number {
  return t.phaseSpeed * timeSec;
}

/**
 * Rotate (x,y,z) around the chosen axis by `angle = strength * coordOnAxis + phase`.
 * The coordinate on the rotation axis is preserved; the orthogonal pair rotates 2D.
 */
export function applyTwist(
  x: number,
  y: number,
  z: number,
  axis: TwistAxis,
  strength: number,
  phase: number,
): [number, number, number] {
  let s: number;
  if (axis === "x") s = x;
  else if (axis === "y") s = y;
  else s = z;
  const angle = strength * s + phase;
  const c = Math.cos(angle);
  const sn = Math.sin(angle);
  if (axis === "y") {
    // rotate (x, z) plane
    const nx = x * c - z * sn;
    const nz = x * sn + z * c;
    return [nx, y, nz];
  }
  if (axis === "x") {
    // rotate (y, z) plane
    const ny = y * c - z * sn;
    const nz = y * sn + z * c;
    return [x, ny, nz];
  }
  // axis === "z": rotate (x, y) plane
  const nx = x * c - y * sn;
  const ny = x * sn + y * c;
  return [nx, ny, z];
}

/** Used by the App's motion routing to boost twist.strength multiplicatively. */
export function applyMotionToTwist(t: TwistSettings, factor: number): void {
  t.strength *= factor;
}
