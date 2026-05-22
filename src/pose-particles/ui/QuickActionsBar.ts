/**
 * 画面上部に固定表示する Quick Actions バー (Issue #34)。
 *
 * 目的: lil-gui (SettingsPanel) の最下部に埋もれがちな頻用操作を
 * 上部の一本帯に集約して、スクロールと誤タップを減らす。
 *
 * 含めるボタン:
 *  - Preset 選択系: manage / next / random
 *  - ランダム系:     randomize / undo
 *  - 音声ソース:     file / mic / display
 *
 * 設計: docs/plans/2026-05-23-ui-redesign-design.md
 */

export type AudioSourceKind = "file" | "mic" | "display";

export interface QuickActionsCallbacks {
  onRandomize: () => void;
  onUndoRandomize: () => void;
  onOpenPresetManager: () => void;
  onNextPreset: () => void;
  onRandomPreset: () => void;
  /** mic / display 選択時に呼ばれる。file は onSelectAudioFile を使うので呼ばれない。 */
  onSelectAudioSource: (kind: "mic" | "display") => void;
  /** file 選択時に <input type=file> から File を取得して呼ばれる。 */
  onSelectAudioFile: (file: File) => void;
}

const BTN_BASE_STYLE = `
  min-height: 32px; padding: 6px 12px;
  background: rgba(255,255,255,0.08);
  color: #fff; border: 1px solid rgba(255,255,255,0.2);
  border-radius: 4px; cursor: pointer;
  font-size: 12px; font-family: system-ui, sans-serif;
  white-space: nowrap;
`;

const GROUP_STYLE = "display: flex; gap: 8px; align-items: center;";

export class QuickActionsBar {
  private readonly root: HTMLDivElement;
  private readonly undoButton: HTMLButtonElement;
  private readonly statusEl: HTMLDivElement;
  private readonly fileInput: HTMLInputElement;

  constructor(callbacks: QuickActionsCallbacks) {
    this.root = document.createElement("div");
    this.root.setAttribute("data-role", "quick-actions");
    this.root.style.cssText = `
      position: fixed; top: 16px; left: 16px; right: 16px;
      display: flex; justify-content: space-between; align-items: center;
      gap: 16px;
      padding: 8px 12px;
      background: rgba(20,20,20,0.7);
      border: 1px solid rgba(255,255,255,0.15);
      border-radius: 6px;
      backdrop-filter: blur(4px);
      z-index: 55;
      font-family: system-ui, sans-serif; color: #fff;
    `;

    // ---- 左側: Preset 系 + Randomize 系 ----
    const left = document.createElement("div");
    left.style.cssText = `${GROUP_STYLE} flex: 1 1 auto;`;

    const presetGroup = document.createElement("div");
    presetGroup.style.cssText = GROUP_STYLE;
    presetGroup.appendChild(
      makeButton("manage…", "open-manager", callbacks.onOpenPresetManager),
    );
    presetGroup.appendChild(
      makeButton("next ▶", "next-preset", callbacks.onNextPreset),
    );
    presetGroup.appendChild(
      makeButton("random", "random-preset", callbacks.onRandomPreset),
    );

    const sep1 = makeSeparator();

    const randomizeGroup = document.createElement("div");
    randomizeGroup.style.cssText = GROUP_STYLE;
    randomizeGroup.appendChild(
      makeButton("🎲 randomize", "randomize", callbacks.onRandomize),
    );
    this.undoButton = makeButton("↶ undo", "undo-randomize", callbacks.onUndoRandomize);
    // 初期状態は履歴がないので disabled。
    this.undoButton.disabled = true;
    randomizeGroup.appendChild(this.undoButton);

    left.appendChild(presetGroup);
    left.appendChild(sep1);
    left.appendChild(randomizeGroup);

    // ---- 右側: 音声ソース + ステータス ----
    const right = document.createElement("div");
    right.style.cssText = `${GROUP_STYLE} flex: 0 0 auto;`;

    this.statusEl = document.createElement("div");
    this.statusEl.setAttribute("data-role", "audio-status");
    this.statusEl.style.cssText = `
      font-size: 11px; opacity: 0.7;
      max-width: 240px; overflow: hidden; text-overflow: ellipsis;
      white-space: nowrap;
    `;
    right.appendChild(this.statusEl);

    const fileButton = makeButton("🎵 file", "", () => {
      this.fileInput.click();
    });
    fileButton.setAttribute("data-audio-source", "file");
    right.appendChild(fileButton);

    this.fileInput = document.createElement("input");
    this.fileInput.type = "file";
    this.fileInput.accept = "audio/*";
    this.fileInput.style.display = "none";
    this.fileInput.addEventListener("change", () => {
      const f = this.fileInput.files?.[0];
      if (f) callbacks.onSelectAudioFile(f);
    });
    right.appendChild(this.fileInput);

    const micButton = makeButton("🎤 mic", "", () => callbacks.onSelectAudioSource("mic"));
    micButton.setAttribute("data-audio-source", "mic");
    right.appendChild(micButton);

    const displayButton = makeButton("🖥 display", "", () => callbacks.onSelectAudioSource("display"));
    displayButton.setAttribute("data-audio-source", "display");
    right.appendChild(displayButton);

    this.root.appendChild(left);
    this.root.appendChild(right);
    document.body.appendChild(this.root);
  }

  setUndoEnabled(enabled: boolean): void {
    this.undoButton.disabled = !enabled;
  }

  setAudioStatus(text: string, isError = false): void {
    this.statusEl.textContent = text;
    this.statusEl.style.color = isError ? "#f88" : "#fff";
    this.statusEl.style.opacity = isError ? "1" : "0.7";
  }

  setVisible(visible: boolean): void {
    this.root.style.display = visible ? "flex" : "none";
  }

  dispose(): void {
    if (this.root.parentElement) this.root.parentElement.removeChild(this.root);
  }
}

function makeButton(
  label: string,
  action: string,
  onClick: () => void,
): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = label;
  if (action) btn.setAttribute("data-action", action);
  btn.style.cssText = BTN_BASE_STYLE;
  btn.addEventListener("click", () => onClick());
  return btn;
}

function makeSeparator(): HTMLDivElement {
  const sep = document.createElement("div");
  sep.style.cssText = `
    width: 1px; height: 20px;
    background: rgba(255,255,255,0.2);
    margin: 0 4px;
  `;
  return sep;
}
