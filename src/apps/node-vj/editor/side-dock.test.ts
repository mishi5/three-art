import { expect, test, describe } from "bun:test";
import {
  nextActivePanel, shouldAutoClose, activityButtonStyle, headerUnderline, dockPlacement, BAR_W,
} from "./side-dock";

describe("nextActivePanel", () => {
  test("別パネルをクリックしたらそれをアクティブに", () => {
    expect(nextActivePanel(null, "asset")).toBe("asset");
    expect(nextActivePanel("asset", "scene")).toBe("scene");
  });
  test("アクティブを再クリックしたら閉じる（null）", () => {
    expect(nextActivePanel("asset", "asset")).toBeNull();
  });
});

// #228: パネル外 pointerdown での自動クローズ判定
describe("shouldAutoClose", () => {
  const base = { pinned: false, paneOpen: true, targetInBar: false, targetInPane: false };

  test("非ピンでパネル外（キャンバス等）なら閉じる", () => {
    expect(shouldAutoClose(base)).toBe(true);
  });
  test("ピン中は外側でも閉じない", () => {
    expect(shouldAutoClose({ ...base, pinned: true })).toBe(false);
  });
  test("パネルが閉じているときは何もしない", () => {
    expect(shouldAutoClose({ ...base, paneOpen: false })).toBe(false);
  });
  test("アクティビティバー内の pointerdown では閉じない（アイコンのトグルに委ねる）", () => {
    expect(shouldAutoClose({ ...base, targetInBar: true })).toBe(false);
  });
  test("パネル内の pointerdown では閉じない（パネル内操作で誤クローズしない）", () => {
    expect(shouldAutoClose({ ...base, targetInPane: true })).toBe(false);
  });
});

// #259: アイコンは全パネル共通のグレー系（識別色はヘッダ下線と行側で表現）
describe("activityButtonStyle", () => {
  test("非アクティブは従来のグレー", () => {
    expect(activityButtonStyle(false)).toEqual({ background: "transparent", color: "#9ab" });
  });
  test("アクティブは従来のハイライト（accent では着色しない）", () => {
    expect(activityButtonStyle(true)).toEqual({ background: "#243042", color: "#cfe" });
  });
});

// #258: 左右対応。バー/パネルの配置 CSS 断片を side から決める。
describe("dockPlacement", () => {
  test("left はバーが画面左端・パネルがバーの右（従来配置）", () => {
    const p = dockPlacement("left");
    expect(p.bar).toContain("left:0;");
    expect(p.bar).toContain("border-right");
    expect(p.pane).toContain(`left:${BAR_W}px;`);
    expect(p.pane).toContain("border-right");
    expect(p.pane).toContain("border-radius:0 6px 6px 0;");
  });

  test("right はバーが画面右端・パネルがバーの左（左右鏡像）", () => {
    const p = dockPlacement("right");
    expect(p.bar).toContain("right:0;");
    expect(p.bar).toContain("border-left");
    expect(p.pane).toContain(`right:${BAR_W}px;`);
    expect(p.pane).toContain("border-left");
    expect(p.pane).toContain("border-radius:6px 0 0 6px;");
  });
});

describe("headerUnderline", () => {
  test("accent 指定時は 2px のアクセント下線", () => {
    expect(headerUnderline("#c08a4a")).toBe("2px solid #c08a4a");
  });
  test("未指定は透明の下線（レイアウトを揺らさない・従来表示）", () => {
    expect(headerUnderline()).toBe("2px solid transparent");
  });
});
