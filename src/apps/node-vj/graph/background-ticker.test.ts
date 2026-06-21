import { expect, test, describe } from "bun:test";
import { buildTickerWorkerSource } from "./background-ticker";

describe("buildTickerWorkerSource (#148)", () => {
  test("指定 fps の間隔で postMessage する setInterval を含む", () => {
    const src = buildTickerWorkerSource(60);
    expect(src).toContain("setInterval");
    expect(src).toContain("postMessage");
    expect(src).toContain("17");   // round(1000/60) = 17ms
  });

  test("stop メッセージで clearInterval する", () => {
    const src = buildTickerWorkerSource(30);
    expect(src).toContain("onmessage");
    expect(src).toContain("clearInterval");
    expect(src).toContain("33");   // 1000/30 ≒ 33ms
  });

  test("fps<=0 でも最小 1ms にフォールバック（0除算/負値回避）", () => {
    expect(buildTickerWorkerSource(0)).toContain("1");
  });
});
