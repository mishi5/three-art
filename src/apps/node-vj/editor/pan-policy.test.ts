import { describe, expect, it } from "bun:test";
import { backgroundPointerDrag } from "./pan-policy";

describe("backgroundPointerDrag: modern (#207 現行)", () => {
  it("左ボタン単独はパン（空白左ドラッグ＝パン）", () => {
    expect(backgroundPointerDrag({ button: 0, shiftKey: false, spaceDown: false, mode: "modern" })).toBe("pan");
  });

  it("Shift+左ボタンは矩形選択", () => {
    expect(backgroundPointerDrag({ button: 0, shiftKey: true, spaceDown: false, mode: "modern" })).toBe("rect");
  });

  it("Space+左ボタンはパン（Shift 無し）", () => {
    expect(backgroundPointerDrag({ button: 0, shiftKey: false, spaceDown: true, mode: "modern" })).toBe("pan");
  });

  it("Space+Shift+左ボタンはパン（Space が優先）", () => {
    expect(backgroundPointerDrag({ button: 0, shiftKey: true, spaceDown: true, mode: "modern" })).toBe("pan");
  });

  it("中ボタンはパン", () => {
    expect(backgroundPointerDrag({ button: 1, shiftKey: false, spaceDown: false, mode: "modern" })).toBe("pan");
  });

  it("右ボタンはパン", () => {
    expect(backgroundPointerDrag({ button: 2, shiftKey: false, spaceDown: false, mode: "modern" })).toBe("pan");
  });

  it("右ボタン+Shift もパン（button が優先で矩形にならない）", () => {
    expect(backgroundPointerDrag({ button: 2, shiftKey: true, spaceDown: false, mode: "modern" })).toBe("pan");
  });
});

describe("backgroundPointerDrag: legacy (#229・#207 以前の操作)", () => {
  it("左ボタン単独は矩形選択（空白左ドラッグ＝矩形選択）", () => {
    expect(backgroundPointerDrag({ button: 0, shiftKey: false, spaceDown: false, mode: "legacy" })).toBe("rect");
  });

  it("Shift+左ボタンも矩形選択", () => {
    expect(backgroundPointerDrag({ button: 0, shiftKey: true, spaceDown: false, mode: "legacy" })).toBe("rect");
  });

  it("Space+左ボタンはパン", () => {
    expect(backgroundPointerDrag({ button: 0, shiftKey: false, spaceDown: true, mode: "legacy" })).toBe("pan");
  });

  it("Space+Shift+左ボタンはパン（Space が優先）", () => {
    expect(backgroundPointerDrag({ button: 0, shiftKey: true, spaceDown: true, mode: "legacy" })).toBe("pan");
  });

  it("中ボタンはパン", () => {
    expect(backgroundPointerDrag({ button: 1, shiftKey: false, spaceDown: false, mode: "legacy" })).toBe("pan");
  });

  it("右ボタンはパン", () => {
    expect(backgroundPointerDrag({ button: 2, shiftKey: false, spaceDown: false, mode: "legacy" })).toBe("pan");
  });

  it("右ボタン+Shift もパン（button が優先で矩形にならない）", () => {
    expect(backgroundPointerDrag({ button: 2, shiftKey: true, spaceDown: false, mode: "legacy" })).toBe("pan");
  });
});
