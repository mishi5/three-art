import { expect, test, describe } from "bun:test";
import { panelDisplay, formatBytes } from "./asset-panel";

describe("panelDisplay", () => {
  test("open=true は flex・false は none", () => {
    expect(panelDisplay(true)).toBe("flex");
    expect(panelDisplay(false)).toBe("none");
  });
});

describe("formatBytes", () => {
  test("単位を付けて読みやすく整形する", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1048576)).toBe("1.0 MB");
    expect(formatBytes(1073741824)).toBe("1.0 GB");
  });
});
