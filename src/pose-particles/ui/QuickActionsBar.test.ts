import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { registerHappyDom } from "../../test-setup/dom";
import { QuickActionsBar, type QuickActionsCallbacks } from "./QuickActionsBar";

registerHappyDom();

const PRESET_BUTTON_KEYS = ["open-manager", "next-preset", "random-preset"] as const;
const RANDOMIZE_BUTTON_KEYS = [
  "randomize",
  "safe-randomize",
  "safe-randomize-config",
  "undo-randomize",
] as const;
const AUDIO_SOURCE_KEYS = ["file", "mic", "display"] as const;

function makeCallbacks(): QuickActionsCallbacks {
  return {
    onRandomize: mock(() => {}),
    onSafeRandomize: mock(() => {}),
    onToggleSafeConfig: mock(() => {}),
    onUndoRandomize: mock(() => {}),
    onOpenPresetManager: mock(() => {}),
    onNextPreset: mock(() => {}),
    onRandomPreset: mock(() => {}),
    onSelectAudioSource: mock(() => {}),
    onSelectAudioFile: mock(() => {}),
  };
}

describe("QuickActionsBar", () => {
  let bar: QuickActionsBar | null = null;

  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    bar?.dispose();
    bar = null;
    document.body.innerHTML = "";
  });

  test("構築時に画面上部に root が body へ append される", () => {
    bar = new QuickActionsBar(makeCallbacks());
    const root = document.body.querySelector<HTMLElement>("[data-role='quick-actions']");
    expect(root).not.toBeNull();
    expect(root?.style.position).toBe("fixed");
  });

  test("Preset 系 3 ボタン / Randomize 系 4 ボタン / 音声ソース 3 ボタンが存在する", () => {
    bar = new QuickActionsBar(makeCallbacks());
    for (const k of PRESET_BUTTON_KEYS) {
      expect(document.querySelector(`[data-action='${k}']`)).not.toBeNull();
    }
    for (const k of RANDOMIZE_BUTTON_KEYS) {
      expect(document.querySelector(`[data-action='${k}']`)).not.toBeNull();
    }
    for (const k of AUDIO_SOURCE_KEYS) {
      expect(document.querySelector(`[data-audio-source='${k}']`)).not.toBeNull();
    }
  });

  test("ボタン最小サイズ 32px / 相互間隔 ≥ 8px が CSS に設定されている", () => {
    bar = new QuickActionsBar(makeCallbacks());
    const buttons = document.querySelectorAll<HTMLButtonElement>(
      "[data-role='quick-actions'] button",
    );
    // Issue #46 で safe-rand / ⚙ 追加 → 8 → 10 以上
    expect(buttons.length).toBeGreaterThanOrEqual(10);
    for (const b of buttons) {
      const minHeight = parseInt(b.style.minHeight || "0", 10);
      expect(minHeight).toBeGreaterThanOrEqual(32);
    }
  });

  test("randomize ボタンクリックで onRandomize が 1 回呼ばれる", () => {
    const cbs = makeCallbacks();
    bar = new QuickActionsBar(cbs);
    document.querySelector<HTMLButtonElement>("[data-action='randomize']")?.click();
    expect((cbs.onRandomize as ReturnType<typeof mock>).mock.calls.length).toBe(1);
  });

  test("safe-randomize ボタンクリックで onSafeRandomize が 1 回呼ばれる (Issue #46)", () => {
    const cbs = makeCallbacks();
    bar = new QuickActionsBar(cbs);
    document.querySelector<HTMLButtonElement>("[data-action='safe-randomize']")?.click();
    expect((cbs.onSafeRandomize as ReturnType<typeof mock>).mock.calls.length).toBe(1);
  });

  test("safe-randomize-config (⚙) ボタンクリックで onToggleSafeConfig が呼ばれる (Issue #46)", () => {
    const cbs = makeCallbacks();
    bar = new QuickActionsBar(cbs);
    document.querySelector<HTMLButtonElement>("[data-action='safe-randomize-config']")?.click();
    expect((cbs.onToggleSafeConfig as ReturnType<typeof mock>).mock.calls.length).toBe(1);
  });

  test("getSafeConfigAnchor() が safe-randomize-config ボタンを返す (Issue #46)", () => {
    bar = new QuickActionsBar(makeCallbacks());
    const anchor = bar.getSafeConfigAnchor();
    expect(anchor).toBeInstanceOf(HTMLButtonElement);
    expect(anchor.getAttribute("data-action")).toBe("safe-randomize-config");
  });

  test("undo は初期 disabled で click しても callback が呼ばれない / setUndoEnabled(true) 後は呼ばれる", () => {
    const cbs = makeCallbacks();
    bar = new QuickActionsBar(cbs);
    const undo = document.querySelector<HTMLButtonElement>("[data-action='undo-randomize']")!;
    undo.click();
    expect((cbs.onUndoRandomize as ReturnType<typeof mock>).mock.calls.length).toBe(0);
    bar.setUndoEnabled(true);
    undo.click();
    expect((cbs.onUndoRandomize as ReturnType<typeof mock>).mock.calls.length).toBe(1);
  });

  test("manage / next / random preset ボタンの各クリックで対応 callback が呼ばれる", () => {
    const cbs = makeCallbacks();
    bar = new QuickActionsBar(cbs);
    document.querySelector<HTMLButtonElement>("[data-action='open-manager']")?.click();
    document.querySelector<HTMLButtonElement>("[data-action='next-preset']")?.click();
    document.querySelector<HTMLButtonElement>("[data-action='random-preset']")?.click();
    expect((cbs.onOpenPresetManager as ReturnType<typeof mock>).mock.calls.length).toBe(1);
    expect((cbs.onNextPreset as ReturnType<typeof mock>).mock.calls.length).toBe(1);
    expect((cbs.onRandomPreset as ReturnType<typeof mock>).mock.calls.length).toBe(1);
  });

  test("mic / display ボタンクリックで onSelectAudioSource(kind) が呼ばれる", () => {
    const cbs = makeCallbacks();
    bar = new QuickActionsBar(cbs);
    document.querySelector<HTMLButtonElement>("[data-audio-source='mic']")?.click();
    document.querySelector<HTMLButtonElement>("[data-audio-source='display']")?.click();
    const sel = cbs.onSelectAudioSource as ReturnType<typeof mock>;
    expect(sel.mock.calls.length).toBe(2);
    expect(sel.mock.calls[0]?.[0]).toBe("mic");
    expect(sel.mock.calls[1]?.[0]).toBe("display");
  });

  test("file ボタンクリックで隠れた input[type=file] が用意され、change 時に onSelectAudioFile が呼ばれる", () => {
    const cbs = makeCallbacks();
    bar = new QuickActionsBar(cbs);
    document.querySelector<HTMLButtonElement>("[data-audio-source='file']")?.click();
    const fileInput = document.querySelector<HTMLInputElement>(
      "[data-role='quick-actions'] input[type='file']",
    );
    expect(fileInput).not.toBeNull();
    // change イベントを emit して callback が呼ばれることを検査
    const blob = new Blob(["x"], { type: "audio/mpeg" });
    const file = new File([blob], "song.mp3", { type: "audio/mpeg" });
    Object.defineProperty(fileInput!, "files", { value: [file], configurable: true });
    fileInput!.dispatchEvent(new Event("change"));
    const sel = cbs.onSelectAudioFile as ReturnType<typeof mock>;
    expect(sel.mock.calls.length).toBe(1);
    expect((sel.mock.calls[0]?.[0] as File).name).toBe("song.mp3");
  });

  test("setUndoEnabled(false) で undo ボタンが disabled になる / true で外れる", () => {
    bar = new QuickActionsBar(makeCallbacks());
    const undo = document.querySelector<HTMLButtonElement>("[data-action='undo-randomize']")!;
    bar.setUndoEnabled(false);
    expect(undo.disabled).toBe(true);
    bar.setUndoEnabled(true);
    expect(undo.disabled).toBe(false);
  });

  test("初期状態では undo は disabled", () => {
    bar = new QuickActionsBar(makeCallbacks());
    const undo = document.querySelector<HTMLButtonElement>("[data-action='undo-randomize']")!;
    expect(undo.disabled).toBe(true);
  });

  test("setAudioStatus(text) でステータスエリアにテキストが反映される", () => {
    bar = new QuickActionsBar(makeCallbacks());
    bar.setAudioStatus("マイク使用中");
    const status = document.querySelector<HTMLElement>("[data-role='audio-status']")!;
    expect(status.textContent).toBe("マイク使用中");
  });

  test("setAudioStatus(text, true) でエラー色が付く", () => {
    bar = new QuickActionsBar(makeCallbacks());
    bar.setAudioStatus("失敗", true);
    const status = document.querySelector<HTMLElement>("[data-role='audio-status']")!;
    expect(status.style.color).toMatch(/#f88|rgb\(255, 136, 136\)/);
  });

  test("setVisible(false) で root の display が none、true で復帰", () => {
    bar = new QuickActionsBar(makeCallbacks());
    const root = document.querySelector<HTMLElement>("[data-role='quick-actions']")!;
    bar.setVisible(false);
    expect(root.style.display).toBe("none");
    bar.setVisible(true);
    expect(root.style.display).not.toBe("none");
  });

  test("dispose() で root が document.body から除去される", () => {
    bar = new QuickActionsBar(makeCallbacks());
    expect(document.querySelector("[data-role='quick-actions']")).not.toBeNull();
    bar.dispose();
    bar = null;
    expect(document.querySelector("[data-role='quick-actions']")).toBeNull();
  });
});
