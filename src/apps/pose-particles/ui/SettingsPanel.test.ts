import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { registerHappyDom } from "../../../test-setup/dom";
import { SettingsPanel } from "./SettingsPanel";
import { makeDefaultSettings, type Settings } from "../settings";

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

describe("SettingsPanel: safeRandomize API (Issue #46)", () => {
  let panel: SettingsPanel | null = null;

  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    panel?.dispose();
    panel = null;
    document.body.innerHTML = "";
  });

  test("safeRandomize() を呼ぶと canUndoRandomize() = true、undoRandomize() で復元", () => {
    panel = build();
    panel.safeRandomize(new Set());
    expect(panel.canUndoRandomize()).toBe(true);
    panel.undoRandomize();
    expect(panel.canUndoRandomize()).toBe(false);
  });

  test("safeRandomize(excluded) で除外 path の値は変わらない (camera.autoRotateSpeed / blur.*)", () => {
    panel = build();
    const settings = (panel as unknown as { settings: { mode: string; camera: { autoRotateSpeed: number }; blur: { enabled: boolean; strength: number; iterations: number; bassDrive: number } } }).settings;
    settings.mode = "bones";
    settings.camera.autoRotateSpeed = 4.2;
    settings.blur.enabled = true;
    settings.blur.strength = 19.3;
    settings.blur.iterations = 5;
    settings.blur.bassDrive = 1.75;
    const excluded = new Set([
      "camera.autoRotateSpeed",
      "blur.enabled",
      "blur.strength",
      "blur.iterations",
      "blur.bassDrive",
    ]);
    // 多回実行しても除外 path は不変であること
    for (let i = 0; i < 5; i++) panel.safeRandomize(excluded);
    expect(settings.camera.autoRotateSpeed).toBe(4.2);
    expect(settings.blur.enabled).toBe(true);
    expect(settings.blur.strength).toBe(19.3);
    expect(settings.blur.iterations).toBe(5);
    expect(settings.blur.bassDrive).toBe(1.75);
  });

  test("setOnUndoStateChange(cb): safeRandomize() でも cb(true) が通知される", () => {
    panel = build();
    const cb = mock((_: boolean) => {});
    panel.setOnUndoStateChange(cb);
    panel.safeRandomize(new Set());
    expect(cb.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(cb.mock.calls[cb.mock.calls.length - 1]?.[0]).toBe(true);
  });
});

describe("SettingsPanel: applyPreset の defaults baseline (Issue #51)", () => {
  let panel: SettingsPanel | null = null;

  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    panel?.dispose();
    panel = null;
    document.body.innerHTML = "";
  });

  function getSettings(p: SettingsPanel): Settings {
    return (p as unknown as { settings: Settings }).settings;
  }

  test("旧形式 preset (post キー欠如) を適用すると post.* が defaults 値 = enabled:false に戻る", () => {
    panel = build();
    const live = getSettings(panel);
    live.post.kaleidoscope.enabled = true;
    live.post.kaleidoscope.segments = 12;
    live.post.fractal.enabled = true;
    live.post.fractal.iterations = 6;

    // 旧形式 = post キーがそもそも無い preset
    const oldPreset = makeDefaultSettings() as Settings & { post?: unknown };
    delete (oldPreset as { post?: unknown }).post;

    panel.applyPreset(oldPreset as Settings);

    expect(live.post.kaleidoscope.enabled).toBe(false);
    expect(live.post.kaleidoscope.segments).toBe(6);
    expect(live.post.fractal.enabled).toBe(false);
    expect(live.post.fractal.iterations).toBe(3);
  });

  test("旧形式 preset (edges.wave / edges.rewire キー欠如) で enabled:false に戻る", () => {
    panel = build();
    const live = getSettings(panel);
    live.edges.wave.enabled = true;
    live.edges.wave.amplitude = 0.3;
    live.edges.rewire.enabled = true;
    live.edges.rewire.interval = 0.8;

    const oldPreset = makeDefaultSettings();
    delete (oldPreset.edges as { wave?: unknown }).wave;
    delete (oldPreset.edges as { rewire?: unknown }).rewire;

    panel.applyPreset(oldPreset);

    expect(live.edges.wave.enabled).toBe(false);
    expect(live.edges.wave.amplitude).toBe(0.05);
    expect(live.edges.rewire.enabled).toBe(false);
    expect(live.edges.rewire.interval).toBe(1.5);
  });

  test("新エフェクトキーを含む preset を適用すれば指定値で上書きされる (回帰防止)", () => {
    panel = build();
    const live = getSettings(panel);

    const newPreset = makeDefaultSettings();
    newPreset.post.kaleidoscope.enabled = true;
    newPreset.post.kaleidoscope.segments = 10;
    newPreset.post.fractal.enabled = true;
    newPreset.post.fractal.iterations = 5;

    panel.applyPreset(newPreset);

    expect(live.post.kaleidoscope.enabled).toBe(true);
    expect(live.post.kaleidoscope.segments).toBe(10);
    expect(live.post.fractal.enabled).toBe(true);
    expect(live.post.fractal.iterations).toBe(5);
  });

  test("preset 側に未指定でも、live で変更された任意フィールドが defaults に戻る (camera.autoRotateSpeed)", () => {
    panel = build();
    const live = getSettings(panel);
    live.camera.autoRotateSpeed = 4.0;

    const partialPreset = makeDefaultSettings();
    delete (partialPreset as { camera?: unknown }).camera;

    panel.applyPreset(partialPreset);

    expect(live.camera.autoRotateSpeed).toBe(0.0);
  });

  test("applyPreset 後も settings オブジェクトの identity は保持される (lil-gui 参照のため)", () => {
    panel = build();
    const liveBefore = getSettings(panel);
    panel.applyPreset(makeDefaultSettings());
    const liveAfter = getSettings(panel);
    expect(liveAfter).toBe(liveBefore);
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
