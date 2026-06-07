import { describe, expect, test } from "bun:test";
import {
  applyTwist,
  axisToInt,
  effectiveTwistStrength,
  twistPhase,
  type TwistSettings,
} from "./twist";
import { applyMotionToTwist } from "./twist";

const defaultTwist: TwistSettings = {
  enabled: true,
  axis: "y",
  strength: 1.0,
  bassDrive: 0.0,
  phaseSpeed: 0.0,
};

describe("axisToInt", () => {
  test("x=0, y=1, z=2", () => {
    expect(axisToInt("x")).toBe(0);
    expect(axisToInt("y")).toBe(1);
    expect(axisToInt("z")).toBe(2);
  });
});

describe("effectiveTwistStrength", () => {
  test("enabled=false yields 0", () => {
    const off: TwistSettings = { ...defaultTwist, enabled: false, strength: 5 };
    expect(effectiveTwistStrength(off, 0.5)).toBe(0);
  });

  test("no bassDrive returns plain strength", () => {
    const t: TwistSettings = { ...defaultTwist, strength: 2.0, bassDrive: 0 };
    expect(effectiveTwistStrength(t, 0.7)).toBe(2.0);
  });

  test("bassDrive boosts strength multiplicatively", () => {
    const t: TwistSettings = { ...defaultTwist, strength: 2.0, bassDrive: 1.5 };
    // 2.0 * (1 + 0.4 * 1.5) = 2.0 * 1.6 = 3.2
    expect(effectiveTwistStrength(t, 0.4)).toBeCloseTo(3.2, 6);
  });
});

describe("twistPhase", () => {
  test("phaseSpeed * timeSec", () => {
    const t: TwistSettings = { ...defaultTwist, phaseSpeed: 1.5 };
    expect(twistPhase(t, 2.0)).toBeCloseTo(3.0, 6);
  });

  test("zero phaseSpeed yields 0", () => {
    const t: TwistSettings = { ...defaultTwist, phaseSpeed: 0 };
    expect(twistPhase(t, 99)).toBe(0);
  });

  test("enabled=false yields 0 even with non-zero phaseSpeed and time", () => {
    const off: TwistSettings = { ...defaultTwist, enabled: false, phaseSpeed: 1.5 };
    expect(twistPhase(off, 99)).toBe(0);
  });
});

describe("applyTwist axis=y", () => {
  test("y=0 means no rotation", () => {
    const [x, y, z] = applyTwist(1, 0, 0, "y", 5.0, 0);
    expect(x).toBeCloseTo(1, 6);
    expect(y).toBeCloseTo(0, 6);
    expect(z).toBeCloseTo(0, 6);
  });

  test("90deg rotation at y=1, strength=PI/2", () => {
    // angle = PI/2 * 1 = PI/2. (x,z)=(1,0) rotates to (0,1)
    const [x, y, z] = applyTwist(1, 1, 0, "y", Math.PI / 2, 0);
    expect(x).toBeCloseTo(0, 5);
    expect(y).toBeCloseTo(1, 6);
    expect(z).toBeCloseTo(1, 5);
  });

  test("phase shifts angle even at zero strength", () => {
    // strength=0, phase=PI => angle = PI for any height
    const [x, y, z] = applyTwist(1, 5, 0, "y", 0, Math.PI);
    expect(x).toBeCloseTo(-1, 5);
    expect(y).toBeCloseTo(5, 6);
    expect(z).toBeCloseTo(0, 5);
  });

  test("y-axis: cylindrical radius is preserved", () => {
    const r0 = Math.sqrt(0.7 * 0.7 + (-0.4) * (-0.4));
    const [x, y, z] = applyTwist(0.7, 2.3, -0.4, "y", 1.7, 0.5);
    expect(y).toBeCloseTo(2.3, 6);
    const r1 = Math.sqrt(x * x + z * z);
    expect(r1).toBeCloseTo(r0, 6);
  });
});

describe("applyTwist axis=x", () => {
  test("x=0 means no rotation", () => {
    const [x, y, z] = applyTwist(0, 1, 0, "x", 3.0, 0);
    expect(x).toBeCloseTo(0, 6);
    expect(y).toBeCloseTo(1, 6);
    expect(z).toBeCloseTo(0, 6);
  });

  test("x-axis preserves x and rotates yz", () => {
    // angle = PI/2 * 1 = PI/2. (y,z)=(1,0) rotates to (0,1)
    const [x, y, z] = applyTwist(1, 1, 0, "x", Math.PI / 2, 0);
    expect(x).toBeCloseTo(1, 6);
    expect(y).toBeCloseTo(0, 5);
    expect(z).toBeCloseTo(1, 5);
  });
});

describe("applyTwist axis=z", () => {
  test("z=0 means no rotation", () => {
    const [x, y, z] = applyTwist(1, 0, 0, "z", 4.0, 0);
    expect(x).toBeCloseTo(1, 6);
    expect(y).toBeCloseTo(0, 6);
    expect(z).toBeCloseTo(0, 6);
  });

  test("z-axis preserves z and rotates xy", () => {
    // angle = PI/2 * 1 = PI/2. (x,y)=(1,0) rotates to (0,1)
    const [x, y, z] = applyTwist(1, 0, 1, "z", Math.PI / 2, 0);
    expect(x).toBeCloseTo(0, 5);
    expect(y).toBeCloseTo(1, 5);
    expect(z).toBeCloseTo(1, 6);
  });
});

describe("applyMotionToTwist", () => {
  test("multiplies strength by factor", () => {
    const t: TwistSettings = { ...defaultTwist, strength: 2.0 };
    applyMotionToTwist(t, 1.5);
    expect(t.strength).toBeCloseTo(3.0, 6);
  });
});
