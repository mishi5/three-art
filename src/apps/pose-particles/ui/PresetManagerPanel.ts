import type { Preset } from "../presets/types";
import type { PresetStore } from "../presets/PresetStore";
import type { Settings } from "../settings";
import { serializeBundleYaml, parseBundleYaml } from "../presets/bundle-yaml";
import { imageToThumbnailDataURL } from "../presets/thumbnail-capture";
import { nextDefaultPresetName } from "./preset-name";

export interface PresetManagerCallbacks {
  /** 「Save current」で使用。現在の Settings を取得 (構造コピー推奨)。 */
  getCurrentSettings: () => Settings;
  /** 選択時に呼ばれる。呼ばれ側で SettingsPanel.applyPreset を実行する。 */
  onApply: (preset: Preset) => void;
  /** 「Save current」で使用。サムネを取得 (data URL)。 */
  captureThumbnail: () => string;
}

/**
 * 中央オーバーレイモーダル。lil-gui の "manage presets…" ボタンから show() する。
 * 表示中は背景クリック / Esc / × で hide()。z-index は SettingsPanel(55) より上 (80)。
 */
export class PresetManagerPanel {
  private root: HTMLDivElement;
  private gridEl: HTMLDivElement;
  private detailEl: HTMLDivElement;
  private activeId: string | null = null;
  private onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape" && this.isVisible()) this.hide();
  };

  constructor(
    private readonly store: PresetStore,
    private readonly callbacks: PresetManagerCallbacks,
  ) {
    this.root = document.createElement("div");
    this.root.style.cssText = `
      position: fixed; inset: 0; z-index: 80;
      background: rgba(0,0,0,0.55);
      display: none;
      font: 13px/1.5 -apple-system, sans-serif;
    `;
    this.root.addEventListener("click", (e) => {
      if (e.target === this.root) this.hide();
    });

    const panel = document.createElement("div");
    panel.style.cssText = `
      max-width: 880px; max-height: 90vh; overflow-y: auto;
      margin: 5vh auto;
      background: #1a1a1a; color: #eee;
      border-radius: 8px; padding: 16px 20px;
      box-shadow: 0 12px 40px rgba(0,0,0,0.5);
    `;
    panel.addEventListener("click", (e) => e.stopPropagation());
    this.root.appendChild(panel);

    // header
    const header = document.createElement("div");
    header.style.cssText = "display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;";
    const title = document.createElement("div");
    title.textContent = "Preset Manager";
    title.style.cssText = "font-size: 16px; font-weight: 600;";
    const close = document.createElement("button");
    close.textContent = "×";
    close.style.cssText = "background: transparent; color: #eee; border: 0; font-size: 22px; cursor: pointer;";
    close.addEventListener("click", () => this.hide());
    header.append(title, close);
    panel.appendChild(header);

    // save current
    const saveBtn = document.createElement("button");
    saveBtn.textContent = "+ Save current as preset";
    saveBtn.style.cssText = "width: 100%; padding: 8px 12px; margin-bottom: 14px; background: #2a3a4a; color: #eee; border: 0; border-radius: 4px; cursor: pointer;";
    saveBtn.addEventListener("click", () => this.onSaveCurrent());
    panel.appendChild(saveBtn);

    // grid
    this.gridEl = document.createElement("div");
    this.gridEl.style.cssText = "display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px;";
    panel.appendChild(this.gridEl);

    // detail
    this.detailEl = document.createElement("div");
    this.detailEl.style.cssText = "margin-top: 14px; padding: 12px; background: #111; border-radius: 6px;";
    panel.appendChild(this.detailEl);

    // export / import all
    const ioBar = document.createElement("div");
    ioBar.style.cssText = "display: flex; gap: 8px; margin-top: 14px;";
    const exportBtn = document.createElement("button");
    exportBtn.textContent = "Export all (.yaml)";
    exportBtn.style.cssText = "flex: 1; padding: 6px 10px; background: #333; color: #eee; border: 0; border-radius: 4px; cursor: pointer;";
    exportBtn.addEventListener("click", () => this.onExportAll());
    const importBtn = document.createElement("button");
    importBtn.textContent = "Import all (.yaml)";
    importBtn.style.cssText = "flex: 1; padding: 6px 10px; background: #333; color: #eee; border: 0; border-radius: 4px; cursor: pointer;";
    importBtn.addEventListener("click", () => this.onImportAll());
    ioBar.append(exportBtn, importBtn);
    panel.appendChild(ioBar);

    document.body.appendChild(this.root);
    window.addEventListener("keydown", this.onKeyDown);
    this.renderList();
  }

  show(): void {
    this.root.style.display = "block";
    this.renderList();
  }

  hide(): void {
    this.root.style.display = "none";
  }

  isVisible(): boolean {
    return this.root.style.display !== "none";
  }

  getActivePresetId(): string | null {
    return this.activeId;
  }

  setActivePresetId(id: string | null): void {
    this.activeId = id;
    if (this.isVisible()) this.renderList();
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    this.root.remove();
  }

  // ---------- 内部処理 ----------

  private renderList(): void {
    this.gridEl.replaceChildren();
    const items = this.store.list();
    if (items.length === 0) {
      const empty = document.createElement("div");
      empty.textContent = "(まだプリセットがありません。上の Save ボタンで登録できます)";
      empty.style.cssText = "color: #888; padding: 16px;";
      this.gridEl.appendChild(empty);
      this.renderDetail(null);
      return;
    }
    for (const p of items) {
      this.gridEl.appendChild(this.renderCard(p));
    }
    const active = this.activeId ? this.store.get(this.activeId) : null;
    this.renderDetail(active);
  }

  private renderCard(p: Preset): HTMLDivElement {
    const card = document.createElement("div");
    const isActive = this.activeId === p.id;
    card.style.cssText = `
      background: #222; border-radius: 6px; padding: 8px;
      cursor: pointer; user-select: none;
      outline: ${isActive ? "2px solid #5ac" : "1px solid #333"};
    `;
    const img = document.createElement("img");
    img.src = p.thumbnail;
    img.alt = p.name;
    img.style.cssText = "width: 100%; aspect-ratio: 16/9; object-fit: contain; background: #000; border-radius: 4px;";
    const name = document.createElement("div");
    name.textContent = p.name;
    name.style.cssText = "margin-top: 6px; font-weight: 500;";
    const desc = document.createElement("div");
    desc.textContent = p.description.split("\n")[0] ?? "";
    desc.style.cssText = "font-size: 11px; color: #aaa; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;";
    card.append(img, name, desc);
    card.addEventListener("click", () => {
      this.activeId = p.id;
      this.callbacks.onApply(p);
      this.renderList();
    });
    return card;
  }

  private renderDetail(p: Preset | null): void {
    this.detailEl.replaceChildren();
    if (!p) {
      this.detailEl.textContent = "(カードを選択すると編集できます)";
      this.detailEl.style.color = "#888";
      return;
    }
    this.detailEl.style.color = "#eee";
    const heading = document.createElement("div");
    heading.textContent = "Detail (選択中)";
    heading.style.cssText = "font-weight: 600; margin-bottom: 8px;";
    this.detailEl.appendChild(heading);

    const row = (label: string, input: HTMLElement) => {
      const wrap = document.createElement("label");
      wrap.style.cssText = "display: block; margin-bottom: 8px;";
      const span = document.createElement("span");
      span.textContent = label;
      span.style.cssText = "display: block; font-size: 11px; color: #aaa; margin-bottom: 2px;";
      wrap.append(span, input);
      this.detailEl.appendChild(wrap);
    };

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.value = p.name;
    nameInput.style.cssText = "width: 100%; padding: 4px 6px; background: #222; color: #eee; border: 1px solid #444; border-radius: 3px;";
    nameInput.addEventListener("input", () => {
      this.store.update(p.id, { name: nameInput.value });
      this.renderList();
    });
    row("name", nameInput);

    const descInput = document.createElement("textarea");
    descInput.value = p.description;
    descInput.rows = 2;
    descInput.style.cssText = "width: 100%; padding: 4px 6px; background: #222; color: #eee; border: 1px solid #444; border-radius: 3px; resize: vertical;";
    descInput.addEventListener("input", () => {
      this.store.update(p.id, { description: descInput.value });
      // テキストはカード側の 1 行プレビューにも反映するため再描画
      this.renderList();
    });
    row("description", descInput);

    const buttons = document.createElement("div");
    buttons.style.cssText = "display: flex; gap: 8px; margin-top: 6px;";

    const applyBtn = document.createElement("button");
    applyBtn.textContent = "apply";
    applyBtn.style.cssText = "padding: 6px 10px; background: #2a4a6a; color: #eee; border: 0; border-radius: 4px; cursor: pointer;";
    applyBtn.addEventListener("click", () => this.callbacks.onApply(p));

    const replaceBtn = document.createElement("button");
    replaceBtn.textContent = "replace thumb";
    replaceBtn.style.cssText = "padding: 6px 10px; background: #333; color: #eee; border: 0; border-radius: 4px; cursor: pointer;";
    replaceBtn.addEventListener("click", () => this.onReplaceThumb(p));

    const deleteBtn = document.createElement("button");
    deleteBtn.textContent = "delete";
    deleteBtn.style.cssText = "padding: 6px 10px; background: #4a2a2a; color: #eee; border: 0; border-radius: 4px; cursor: pointer; margin-left: auto;";
    deleteBtn.addEventListener("click", () => this.onDelete(p));

    buttons.append(applyBtn, replaceBtn, deleteBtn);
    this.detailEl.appendChild(buttons);
  }

  private onSaveCurrent(): void {
    const names = this.store.list().map((p) => p.name);
    const defaultName = nextDefaultPresetName(names);
    const name = window.prompt("preset name?", defaultName);
    if (name === null) return;
    let thumbnail = "";
    try {
      thumbnail = this.callbacks.captureThumbnail();
    } catch (e) {
      console.warn("[PresetManager] thumbnail capture failed:", e);
    }
    try {
      const p = this.store.add({
        name,
        description: "",
        thumbnail,
        settings: this.callbacks.getCurrentSettings(),
      });
      this.activeId = p.id;
      this.renderList();
    } catch (e) {
      window.alert("プリセットの保存に失敗しました: " + (e instanceof Error ? e.message : String(e)));
    }
  }

  private async onReplaceThumb(p: Preset): Promise<void> {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/webp";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const url = await imageToThumbnailDataURL(file);
        this.store.update(p.id, { thumbnail: url });
        this.renderList();
      } catch (e) {
        window.alert("画像の読み込みに失敗しました: " + (e instanceof Error ? e.message : String(e)));
      }
    });
    input.click();
  }

  private onDelete(p: Preset): void {
    if (!window.confirm(`プリセット "${p.name}" を削除します。よろしいですか?`)) return;
    this.store.remove(p.id);
    if (this.activeId === p.id) this.activeId = null;
    this.renderList();
  }

  private onExportAll(): void {
    const text = serializeBundleYaml(this.store.toBundle());
    const blob = new Blob([text], { type: "application/x-yaml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    a.download = `pose-particles-presets-${ts}.yaml`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  private onImportAll(): void {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".yaml,.yml,application/x-yaml,text/yaml";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const bundle = parseBundleYaml(text);
        this.store.fromBundle(bundle);
        this.activeId = null;
        this.renderList();
      } catch (e) {
        window.alert("プリセット一式の読み込みに失敗しました: " + (e instanceof Error ? e.message : String(e)));
      }
    });
    input.click();
  }
}
