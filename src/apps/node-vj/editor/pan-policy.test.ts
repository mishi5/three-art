import { describe, expect, it } from "bun:test";
import { backgroundPointerDrag } from "./pan-policy";

describe("backgroundPointerDrag (#207)", () => {
  it("左ボタン単独はパン（空白左ドラッグ＝パン）", () => {
    expect(backgroundPointerDrag({ button: 0, shiftKey: false, spaceDown: false })).toBe("pan");
  });

  it("Shift+左ボタンは矩形選択", () => {
    expect(backgroundPointerDrag({ button: 0, shiftKey: true, spaceDown: false })).toBe("rect");
  });

  it("Space+左ボタンはパン（Shift 無し）", () => {
    expect(backgroundPointerDrag({ button: 0, shiftKey: false, spaceDown: true })).toBe("pan");
  });

  it("Space+Shift+左ボタンはパン（Space が優先）", () => {
    expect(backgroundPointerDrag({ button: 0, shiftKey: true, spaceDown: true })).toBe("pan");
  });

  it("中ボタンはパン", () => {
    expect(backgroundPointerDrag({ button: 1, shiftKey: false, spaceDown: false })).toBe("pan");
  });

  it("右ボタンはパン", () => {
    expect(backgroundPointerDrag({ button: 2, shiftKey: false, spaceDown: false })).toBe("pan");
  });

  it("右ボタン+Shift もパン（button が優先で矩形にならない）", () => {
    expect(backgroundPointerDrag({ button: 2, shiftKey: true, spaceDown: false })).toBe("pan");
  });
});
