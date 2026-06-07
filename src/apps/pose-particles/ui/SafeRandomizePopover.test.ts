import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { registerHappyDom } from "../../../test-setup/dom";
import { SafeRandomizePopover } from "./SafeRandomizePopover";
import { RANDOMIZE_DESCRIPTORS, DEFAULT_SAFE_EXCLUDED } from "./randomize";

registerHappyDom();

function makeAnchor(): HTMLButtonElement {
  const a = document.createElement("button");
  a.textContent = "⚙";
  document.body.appendChild(a);
  return a;
}

describe("SafeRandomizePopover (Issue #46)", () => {
  let popover: SafeRandomizePopover | null = null;
  let anchor: HTMLButtonElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    anchor = makeAnchor();
  });

  afterEach(() => {
    popover?.dispose();
    popover = null;
    document.body.innerHTML = "";
  });

  test("初期状態では非表示 (isOpen=false / DOM 上に存在しない)", () => {
    popover = new SafeRandomizePopover(new Set(DEFAULT_SAFE_EXCLUDED), { onChange: () => {} });
    expect(popover.isOpen()).toBe(false);
    expect(document.querySelector("[data-role='safe-rand-popover']")).toBeNull();
  });

  test("show(anchor) で DOM に挿入され isOpen=true になる", () => {
    popover = new SafeRandomizePopover(new Set(), { onChange: () => {} });
    popover.show(anchor);
    expect(popover.isOpen()).toBe(true);
    expect(document.querySelector("[data-role='safe-rand-popover']")).not.toBeNull();
  });

  test("hide() で DOM から消え isOpen=false", () => {
    popover = new SafeRandomizePopover(new Set(), { onChange: () => {} });
    popover.show(anchor);
    popover.hide();
    expect(popover.isOpen()).toBe(false);
    expect(document.querySelector("[data-role='safe-rand-popover']")).toBeNull();
  });

  test("toggle(anchor) は閉じてれば開く / 開いてれば閉じる", () => {
    popover = new SafeRandomizePopover(new Set(), { onChange: () => {} });
    popover.toggle(anchor);
    expect(popover.isOpen()).toBe(true);
    popover.toggle(anchor);
    expect(popover.isOpen()).toBe(false);
  });

  test("RANDOMIZE_DESCRIPTORS の全 path に対応する checkbox が描画される", () => {
    popover = new SafeRandomizePopover(new Set(), { onChange: () => {} });
    popover.show(anchor);
    const checkboxes = document.querySelectorAll<HTMLInputElement>(
      "[data-role='safe-rand-popover'] input[type='checkbox'][data-path]",
    );
    expect(checkboxes.length).toBe(RANDOMIZE_DESCRIPTORS.length);
    const paths = new Set<string>();
    checkboxes.forEach((c) => paths.add(c.getAttribute("data-path") ?? ""));
    for (const d of RANDOMIZE_DESCRIPTORS) {
      expect(paths.has(d.spec.path)).toBe(true);
    }
  });

  test("初期 ON は initial 集合の path だけ", () => {
    const initial = new Set([
      "camera.autoRotateSpeed",
      "blur.strength",
    ]);
    popover = new SafeRandomizePopover(initial, { onChange: () => {} });
    popover.show(anchor);
    const cb = (path: string) =>
      document.querySelector<HTMLInputElement>(`input[data-path='${path}']`);
    expect(cb("camera.autoRotateSpeed")?.checked).toBe(true);
    expect(cb("blur.strength")?.checked).toBe(true);
    expect(cb("color.hueBase")?.checked).toBe(false);
    expect(cb("blur.enabled")?.checked).toBe(false);
  });

  test("checkbox トグルで onChange が最新の集合を伴って呼ばれる", () => {
    const onChange = mock((_: ReadonlySet<string>) => {});
    popover = new SafeRandomizePopover(new Set(), { onChange });
    popover.show(anchor);
    const cb = document.querySelector<HTMLInputElement>(
      "input[data-path='color.hueBase']",
    )!;
    cb.checked = true;
    cb.dispatchEvent(new Event("change"));
    expect(onChange.mock.calls.length).toBe(1);
    const got = onChange.mock.calls[0]?.[0] as ReadonlySet<string>;
    expect(got.has("color.hueBase")).toBe(true);
    expect(got.size).toBe(1);
  });

  test("グループ header checkbox クリックでそのグループの子を全 ON にして onChange", () => {
    const onChange = mock((_: ReadonlySet<string>) => {});
    popover = new SafeRandomizePopover(new Set(), { onChange });
    popover.show(anchor);
    const header = document.querySelector<HTMLInputElement>(
      "input[data-group='blur']",
    )!;
    expect(header).not.toBeNull();
    header.checked = true;
    header.dispatchEvent(new Event("change"));
    expect(onChange.mock.calls.length).toBe(1);
    const got = onChange.mock.calls[0]?.[0] as ReadonlySet<string>;
    expect(got.has("blur.enabled")).toBe(true);
    expect(got.has("blur.strength")).toBe(true);
    expect(got.has("blur.iterations")).toBe(true);
    expect(got.has("blur.bassDrive")).toBe(true);
  });

  test("グループ header をもう一度クリックすると子を全 OFF", () => {
    const onChange = mock((_: ReadonlySet<string>) => {});
    popover = new SafeRandomizePopover(
      new Set(["blur.enabled", "blur.strength", "blur.iterations", "blur.bassDrive"]),
      { onChange },
    );
    popover.show(anchor);
    const header = document.querySelector<HTMLInputElement>(
      "input[data-group='blur']",
    )!;
    header.checked = false;
    header.dispatchEvent(new Event("change"));
    const got = onChange.mock.calls[0]?.[0] as ReadonlySet<string>;
    expect(got.has("blur.enabled")).toBe(false);
    expect(got.has("blur.strength")).toBe(false);
  });

  test("Esc キーで hide される", () => {
    popover = new SafeRandomizePopover(new Set(), { onChange: () => {} });
    popover.show(anchor);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(popover.isOpen()).toBe(false);
  });

  test("popover 外 (body) の mousedown で hide", () => {
    popover = new SafeRandomizePopover(new Set(), { onChange: () => {} });
    popover.show(anchor);
    const outside = document.createElement("div");
    document.body.appendChild(outside);
    outside.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(popover.isOpen()).toBe(false);
  });

  test("anchor 自体のクリックでは hide しない (toggle で閉じる責務はバー側)", () => {
    popover = new SafeRandomizePopover(new Set(), { onChange: () => {} });
    popover.show(anchor);
    anchor.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(popover.isOpen()).toBe(true);
  });

  test("popover 内の click では hide しない", () => {
    popover = new SafeRandomizePopover(new Set(), { onChange: () => {} });
    popover.show(anchor);
    const inner = document.querySelector<HTMLElement>(
      "[data-role='safe-rand-popover']",
    )!;
    inner.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(popover.isOpen()).toBe(true);
  });

  test("dispose() で DOM とイベントリスナがクリーンアップされる (Esc が無視される)", () => {
    popover = new SafeRandomizePopover(new Set(), { onChange: () => {} });
    popover.show(anchor);
    popover.dispose();
    popover = null;
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    // dispose 後の操作で例外が出ないこと、DOM が消えていること
    expect(document.querySelector("[data-role='safe-rand-popover']")).toBeNull();
  });
});
