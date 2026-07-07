import { expect, test, describe } from "bun:test";
import { panelDisplay, formatBytes, kindIcon, ASSET_ACCENT } from "./asset-panel";
import type { AssetKind } from "./asset-kind";

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

// #259: アセットパネルの視覚差別化（種別アイコン・アクセント定義）
describe("kindIcon", () => {
  test("image/video/audio それぞれに SVG アイコンを返す", () => {
    const kinds: AssetKind[] = ["image", "video", "audio"];
    for (const k of kinds) expect(kindIcon(k)).toContain("<svg");
  });
  test("種別ごとにアイコンが異なる（判別できる）", () => {
    expect(kindIcon("image")).not.toBe(kindIcon("video"));
    expect(kindIcon("video")).not.toBe(kindIcon("audio"));
    expect(kindIcon("audio")).not.toBe(kindIcon("image"));
  });
});

describe("ASSET_ACCENT", () => {
  test("アセット用アクセントカラーが hex で定義されている", () => {
    expect(ASSET_ACCENT).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
