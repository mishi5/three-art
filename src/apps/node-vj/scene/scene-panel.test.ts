import { expect, test, describe } from "bun:test";
import { panelDisplay } from "./scene-panel";

describe("panelDisplay", () => {
  test("open=true は flex・false は none", () => {
    expect(panelDisplay(true)).toBe("flex");
    expect(panelDisplay(false)).toBe("none");
  });
});
