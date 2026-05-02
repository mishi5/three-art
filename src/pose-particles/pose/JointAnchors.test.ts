import { describe, expect, it } from "bun:test";
import { JOINT_INDICES, makeEmptyJoints } from "../types";
import { JointAnchors } from "./JointAnchors";

type Lm = { x: number; y: number; z: number; visibility?: number };

function makeLandmarks(filler: (idx: number) => Lm): Lm[] {
  return Array.from({ length: 33 }, (_, i) => filler(i));
}

describe("JointAnchors", () => {
  it("starts with zero joints", () => {
    const a = new JointAnchors();
    const j = a.getSmoothed();
    expect(j.length).toBe(13 * 3);
    expect(Array.from(j).every((v) => v === 0)).toBe(true);
  });

  it("flips y axis when ingesting MediaPipe coords", () => {
    const a = new JointAnchors();
    a.update(makeLandmarks((i) => ({ x: 0, y: 0.5, z: 0 }))); // y=0.5 (下方)
    a.tick(1.0); // 平滑化を一気に最新へ
    const j = a.getSmoothed();
    // JOINT_INDICES[0] = nose. y成分（index 1）は -0.5 のはず
    expect(j[1]).toBeCloseTo(-0.5, 5);
  });

  it("only extracts the configured joints", () => {
    const a = new JointAnchors();
    a.update(
      makeLandmarks((i) => ({
        x: i === JOINT_INDICES[5] ? 0.9 : 0,
        y: 0,
        z: 0,
      })),
    );
    a.tick(1.0);
    const j = a.getSmoothed();
    expect(j[5 * 3]).toBeCloseTo(0.9, 5); // 6番目の関節 (left wrist) の x
    expect(j[0]).toBe(0); // 1番目 (nose) の x は 0
  });

  it("lerps toward latest at the given factor", () => {
    const a = new JointAnchors();
    a.update(makeLandmarks(() => ({ x: 1, y: 0, z: 0 })));
    a.tick(0.5);
    const j = a.getSmoothed();
    expect(j[0]).toBeCloseTo(0.5, 5); // 0 → 1 を 0.5 lerp
  });
});
