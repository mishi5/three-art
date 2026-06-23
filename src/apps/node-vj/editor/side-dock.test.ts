import { expect, test, describe } from "bun:test";
import { nextActivePanel } from "./side-dock";

describe("nextActivePanel", () => {
  test("別パネルをクリックしたらそれをアクティブに", () => {
    expect(nextActivePanel(null, "asset")).toBe("asset");
    expect(nextActivePanel("asset", "scene")).toBe("scene");
  });
  test("アクティブを再クリックしたら閉じる（null）", () => {
    expect(nextActivePanel("asset", "asset")).toBeNull();
  });
});
