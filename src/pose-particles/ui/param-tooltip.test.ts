import { describe, expect, test } from "bun:test";
import { computeTooltipPosition } from "./param-tooltip";

const VIEWPORT = { width: 1280, height: 800 };

describe("computeTooltipPosition", () => {
  test("places the tooltip to the LEFT of the anchor (GUI sits at right edge)", () => {
    const anchor = { left: 980, top: 300, right: 1264, bottom: 320 };
    const tip = { width: 260, height: 90 };
    const pos = computeTooltipPosition(anchor, tip, VIEWPORT);
    // Right edge of the tooltip must not cover the anchor/GUI panel.
    expect(pos.left + tip.width).toBeLessThanOrEqual(anchor.left);
    expect(pos.top).toBe(anchor.top);
  });

  test("clamps to the viewport when there is no room on the left", () => {
    const anchor = { left: 40, top: 10, right: 320, bottom: 30 };
    const tip = { width: 260, height: 90 };
    const pos = computeTooltipPosition(anchor, tip, VIEWPORT);
    expect(pos.left).toBeGreaterThanOrEqual(0);
    expect(pos.top).toBeGreaterThanOrEqual(0);
    expect(pos.left + tip.width).toBeLessThanOrEqual(VIEWPORT.width);
    expect(pos.top + tip.height).toBeLessThanOrEqual(VIEWPORT.height);
  });

  test("clamps the bottom edge when the anchor is near the viewport floor", () => {
    const anchor = { left: 980, top: 780, right: 1264, bottom: 798 };
    const tip = { width: 260, height: 90 };
    const pos = computeTooltipPosition(anchor, tip, VIEWPORT);
    expect(pos.top + tip.height).toBeLessThanOrEqual(VIEWPORT.height);
  });
});
