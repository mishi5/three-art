// #242: ヘルプポップアップ（DOM）の開閉テスト。
// Esc / 外側クリックで閉じる（#166 closeOnOutside / #228 と同パターン）ことを確認する。
import { expect, test, describe, beforeEach } from "bun:test";
import { registerHappyDom } from "../../../test-setup/dom";
import { HelpPopup, HELP_POPUP_CLASS } from "./help-popup";
import type { PanSelectMode } from "./pan-policy";

registerHappyDom();

function popupEl(): HTMLElement | null {
  return document.querySelector(`.${HELP_POPUP_CLASS}`);
}

function makeAnchor(): HTMLButtonElement {
  const btn = document.createElement("button");
  document.body.appendChild(btn);
  return btn;
}

describe("HelpPopup", () => {
  let mode: PanSelectMode = "modern";
  let popup: HelpPopup;
  let anchor: HTMLButtonElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    mode = "modern";
    popup = new HelpPopup(() => mode);
    anchor = makeAnchor();
  });

  test("toggle で開き、再度 toggle で閉じる", () => {
    expect(popupEl()).toBeNull();
    popup.toggle(anchor);
    expect(popupEl()).not.toBeNull();
    popup.toggle(anchor);
    expect(popupEl()).toBeNull();
  });

  test("開くとセクション見出しと項目が描画される", () => {
    popup.toggle(anchor);
    const text = popupEl()!.textContent ?? "";
    expect(text).toContain("キーボード");
    expect(text).toContain("Cmd+Z");
    expect(text).toContain("右クリック");
  });

  test("操作モードに応じて本文が差し替わる（開くたびに getMode を読む）", () => {
    popup.toggle(anchor);
    expect(popupEl()!.textContent).toContain("Shift+左ドラッグ");
    popup.toggle(anchor);
    mode = "legacy";
    popup.toggle(anchor);
    const text = popupEl()!.textContent ?? "";
    expect(text).not.toContain("Shift+左ドラッグ");
    expect(text).toContain("矩形選択");
  });

  test("Esc キーで閉じる", () => {
    popup.toggle(anchor);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(popupEl()).toBeNull();
  });

  test("Esc 以外のキーでは閉じない", () => {
    popup.toggle(anchor);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    expect(popupEl()).not.toBeNull();
  });

  test("外側の pointerdown で閉じる", () => {
    popup.toggle(anchor);
    const ev = new Event("pointerdown", { bubbles: true });
    document.body.dispatchEvent(ev);
    expect(popupEl()).toBeNull();
  });

  test("ポップアップ内の pointerdown では閉じない", () => {
    popup.toggle(anchor);
    const el = popupEl()!;
    const ev = new Event("pointerdown", { bubbles: true });
    el.dispatchEvent(ev);
    expect(popupEl()).not.toBeNull();
  });

  test("アンカー（? ボタン）上の pointerdown では閉じない（click のトグルに委ねる）", () => {
    popup.toggle(anchor);
    const ev = new Event("pointerdown", { bubbles: true });
    anchor.dispatchEvent(ev);
    expect(popupEl()).not.toBeNull();
  });

  test("close 後は Esc / 外側クリックのリスナが残らない（再度開いても 1 つだけ）", () => {
    popup.toggle(anchor);
    popup.close();
    expect(popupEl()).toBeNull();
    // 閉じた状態で Esc を送っても何も起きない（リスナ解除済み）。
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    popup.toggle(anchor);
    expect(document.querySelectorAll(`.${HELP_POPUP_CLASS}`).length).toBe(1);
  });
});
