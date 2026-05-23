import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { registerHappyDom } from "../../test-setup/dom";
import { SettingsPanel } from "./SettingsPanel";
import { makeDefaultSettings } from "../settings";

registerHappyDom();

function build(): SettingsPanel {
  return new SettingsPanel(makeDefaultSettings(), () => {});
}

function controllerNames(panel: SettingsPanel): string[] {
  // private gui を property 経由で覗く (テスト目的のみ)
  const gui = (panel as unknown as { gui: { controllersRecursive(): Array<{ _name?: string; property?: string }> } }).gui;
  return gui.controllersRecursive().map((c) => (c._name ?? c.property ?? ""));
}

describe("SettingsPanel: Preset folder の整理", () => {
  let panel: SettingsPanel | null = null;

  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    panel?.dispose();
    panel = null;
    document.body.innerHTML = "";
  });

  test("Quick Actions へ移譲したボタンが lil-gui の controller として存在しない", () => {
    panel = build();
    const names = controllerNames(panel);
    expect(names).not.toContain("randomize (current mode)");
    expect(names).not.toContain("undo randomize");
    expect(names).not.toContain("manage presets…");
    expect(names).not.toContain("next preset ▶");
    expect(names).not.toContain("random preset");
  });

  test("低頻度ボタン (reset / export / import) は引き続き存在する", () => {
    panel = build();
    const names = controllerNames(panel);
    expect(names).toContain("reset to defaults");
    expect(names).toContain("export preset (.yaml)");
    expect(names).toContain("import preset (.yaml)");
  });
});

describe("SettingsPanel: public randomize / undoRandomize API", () => {
  let panel: SettingsPanel | null = null;

  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    panel?.dispose();
    panel = null;
    document.body.innerHTML = "";
  });

  test("初期状態では canUndoRandomize() = false", () => {
    panel = build();
    expect(panel.canUndoRandomize()).toBe(false);
  });

  test("randomize() を呼ぶと canUndoRandomize() = true、undoRandomize() で再度 false", () => {
    panel = build();
    panel.randomize();
    expect(panel.canUndoRandomize()).toBe(true);
    panel.undoRandomize();
    expect(panel.canUndoRandomize()).toBe(false);
  });

  test("setOnUndoStateChange(cb): randomize() で cb(true)、undoRandomize() で cb(false)", () => {
    panel = build();
    const cb = mock((_: boolean) => {});
    panel.setOnUndoStateChange(cb);
    panel.randomize();
    expect(cb.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(cb.mock.calls[cb.mock.calls.length - 1]?.[0]).toBe(true);
    panel.undoRandomize();
    expect(cb.mock.calls[cb.mock.calls.length - 1]?.[0]).toBe(false);
  });
});

describe("SettingsPanel: タブ化", () => {
  let panel: SettingsPanel | null = null;

  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    panel?.dispose();
    panel = null;
    document.body.innerHTML = "";
  });

  test("構築直後にタブバーが DOM 上に存在する", () => {
    panel = build();
    const bar = document.querySelector("[data-role='settings-tabs']");
    expect(bar).not.toBeNull();
  });

  test("タブバーに 6 タブ (Audio / Look / Particles / Mode / Post-process / System) が存在する", () => {
    panel = build();
    const expected = ["Audio", "Look", "Particles", "Mode", "Post-process", "System"];
    for (const name of expected) {
      const btn = document.querySelector(`[data-settings-tab='${name}']`);
      expect(btn).not.toBeNull();
    }
  });

  test("初期 active タブは Audio (qa-tab-active クラス)", () => {
    panel = build();
    const active = document.querySelector(".qa-tab-active");
    expect(active?.getAttribute("data-settings-tab")).toBe("Audio");
  });

  test("タブクリックで active が切り替わる", () => {
    panel = build();
    const look = document.querySelector<HTMLButtonElement>("[data-settings-tab='Look']")!;
    look.click();
    const active = document.querySelector(".qa-tab-active");
    expect(active?.getAttribute("data-settings-tab")).toBe("Look");
  });
});
