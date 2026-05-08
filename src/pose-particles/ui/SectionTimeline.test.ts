import { describe, expect, test } from "bun:test";
import type { SectionBoundary } from "../automation/AnalysisCache";
import { addOrRemoveBoundary, pickBoundaryAt } from "./SectionTimeline";

describe("pickBoundaryAt", () => {
  test("hitWindowSec 内の最も近い境界の index を返す", () => {
    const bds: SectionBoundary[] = [
      { t: 5, source: "auto" },
      { t: 10, source: "user-add" },
      { t: 20, source: "auto" },
    ];
    expect(pickBoundaryAt(bds, 10.2, 0.4)).toBe(1);
  });

  test("hitWindow 外なら -1", () => {
    const bds: SectionBoundary[] = [{ t: 5, source: "auto" }];
    expect(pickBoundaryAt(bds, 7, 0.4)).toBe(-1);
  });

  test("空配列なら -1", () => {
    expect(pickBoundaryAt([], 5, 0.4)).toBe(-1);
  });
});

describe("addOrRemoveBoundary", () => {
  test("hit 範囲内に既存があれば削除", () => {
    const bds: SectionBoundary[] = [
      { t: 5, source: "auto" },
      { t: 10, source: "user-add" },
    ];
    expect(addOrRemoveBoundary(bds, 10.1, 0.4)).toHaveLength(1);
    expect(addOrRemoveBoundary(bds, 10.1, 0.4)[0]?.t).toBe(5);
  });

  test("hit 範囲外なら user-add 境界を追加 (時刻ソート維持)", () => {
    const bds: SectionBoundary[] = [
      { t: 5, source: "auto" },
      { t: 20, source: "auto" },
    ];
    const next = addOrRemoveBoundary(bds, 12, 0.4);
    expect(next).toHaveLength(3);
    expect(next.map((b) => b.t)).toEqual([5, 12, 20]);
    expect(next[1]?.source).toBe("user-add");
  });

  test("空配列 + 追加で 1 個になる", () => {
    expect(addOrRemoveBoundary([], 7, 0.4)).toHaveLength(1);
  });
});
