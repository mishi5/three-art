import { expect, test, describe } from "bun:test";
import { nextActivePanel, shouldAutoClose, activityButtonStyle, headerUnderline } from "./side-dock";

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

describe("headerUnderline", () => {
  test("accent 指定時は 2px のアクセント下線", () => {
    expect(headerUnderline("#c08a4a")).toBe("2px solid #c08a4a");
  });
  test("未指定は透明の下線（レイアウトを揺らさない・従来表示）", () => {
    expect(headerUnderline()).toBe("2px solid transparent");
  });
});
