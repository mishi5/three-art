import { expect, test, describe } from "bun:test";
import { sectionIndexAt } from "./input-node-logic";
import type { SectionBoundary } from "../../../core/audio/analysis-types";

const b = (t: number): SectionBoundary => ({ t, source: "auto" });

describe("sectionIndexAt", () => {
  test("boundaries が空なら常に 0", () => {
    expect(sectionIndexAt([], 0)).toBe(0);
    expect(sectionIndexAt([], 100)).toBe(0);
  });

  test("境界をまたぐごとに index が増える", () => {
    const bs = [b(10), b(20), b(30)];
    expect(sectionIndexAt(bs, 5)).toBe(0);
    expect(sectionIndexAt(bs, 10)).toBe(1); // 境界 t<=t を含む
    expect(sectionIndexAt(bs, 15)).toBe(1);
    expect(sectionIndexAt(bs, 25)).toBe(2);
    expect(sectionIndexAt(bs, 35)).toBe(3);
  });
});
