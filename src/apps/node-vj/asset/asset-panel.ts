// #154/#151: アセットライブラリのサイドパネル内容（DOM・手動 / Playwright 確認）。
// #151 でサイドドック（editor/side-dock）に載せ替え。本モジュールは内容を host に mount するだけ。
// 純関数 panelDisplay / formatBytes はテスト対象。
import type { AssetLibrary } from "./asset-library";
import type { AssetMeta } from "./meta-store";
import type { AssetKind } from "./asset-kind";
import type { SidePanelDef } from "../editor/side-dock";

/** 開閉状態 → display 値（純関数・互換のため残置）。 */
export function panelDisplay(open: boolean): "flex" | "none" {
  return open ? "flex" : "none";
}

/** バイト数を人が読みやすい単位へ整形する（純関数）。 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(1)} ${units[i]}`;
}

// 絵文字をやめ、線アイコン（currentColor の SVG）で統一する。
const SVG = (body: string): string =>
  `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
  `stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const ICON = {
  sidebar: SVG('<rect x="3" y="4" width="18" height="16" rx="2"/><line x1="9" y1="4" x2="9" y2="20"/>'),
  image: SVG('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.6"/><polyline points="4 18 9 13 13 16 17 12 20 15"/>'),
  video: SVG('<rect x="3" y="5" width="18" height="14" rx="2"/><polygon points="10 9 16 12 10 15 10 9"/>'),
  audio: SVG('<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>'),
  trash: SVG('<polyline points="4 7 20 7"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/>'),
} as const;
const KIND_ICON: Record<AssetKind, string> = { image: ICON.image, video: ICON.video, audio: ICON.audio };

const BTN_CSS =
  "background:#1c1c22;color:#ddd;border:1px solid #444;border-radius:4px;padding:4px 8px;cursor:pointer;font:12px system-ui;";

function toast(message: string, isError = false): void {
  const div = document.createElement("div");
  div.textContent = message;
  div.style.cssText =
    "position:fixed;left:50%;bottom:48px;transform:translateX(-50%);z-index:300;" +
    "padding:8px 14px;border-radius:4px;font:12px system-ui;color:#fff;" +
    `background:${isError ? "rgba(140,40,40,0.92)" : "rgba(30,90,60,0.92)"};`;
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 2600);
}

/** アセットパネルのサイドドック定義を返す。内容（一覧/追加/使用量）を host に構築する。 */
export function assetPanelDef(library: AssetLibrary): SidePanelDef {
  return {
    id: "asset",
    title: "アセット",
    icon: ICON.sidebar,
    mount: (host) => mountAssetPanel(host, library),
  };
}

function mountAssetPanel(host: HTMLElement, library: AssetLibrary): void {
  let objectUrls: string[] = []; // 再描画時に解放する ObjectURL

  const listEl = document.createElement("div");
  listEl.style.cssText = "display:flex;flex-direction:column;gap:4px;overflow-y:auto;flex:1 1 auto;";
  host.appendChild(listEl);

  const addLabel = document.createElement("label");
  addLabel.textContent = "＋ ファイル追加";
  addLabel.style.cssText = BTN_CSS + "text-align:center;flex:0 0 auto;";
  const addInput = document.createElement("input");
  addInput.type = "file";
  addInput.multiple = true;
  addInput.accept = "image/*,video/*,audio/*";
  addInput.style.display = "none";
  addLabel.appendChild(addInput);
  host.appendChild(addLabel);

  const usageEl = document.createElement("div");
  usageEl.style.cssText = "color:#999;font-size:11px;flex:0 0 auto;";
  host.appendChild(usageEl);

  async function refreshUsage(): Promise<void> {
    try {
      const est = await navigator.storage?.estimate?.();
      if (est && typeof est.usage === "number") {
        const quota = typeof est.quota === "number" && est.quota > 0 ? ` / ${formatBytes(est.quota)}` : "";
        usageEl.textContent = `使用量: ${formatBytes(est.usage)}${quota}`;
      } else {
        usageEl.textContent = "";
      }
    } catch {
      usageEl.textContent = "";
    }
  }

  async function render(): Promise<void> {
    for (const u of objectUrls) URL.revokeObjectURL(u);
    objectUrls = [];
    listEl.innerHTML = "";
    const items = await library.list();
    if (items.length === 0) {
      const empty = document.createElement("div");
      empty.textContent = "（アセットなし）ファイルを D&D / 追加";
      empty.style.cssText = "color:#777;padding:6px 2px;";
      listEl.appendChild(empty);
    }
    for (const meta of items) listEl.appendChild(renderRow(meta));
    void refreshUsage();
  }

  function renderRow(meta: AssetMeta): HTMLElement {
    const row = document.createElement("div");
    row.draggable = true;
    row.title = meta.fileName;
    row.style.cssText =
      "display:flex;align-items:center;gap:6px;padding:4px;border:1px solid #333;" +
      "border-radius:4px;background:#16161c;cursor:grab;";

    const thumb = document.createElement("div");
    thumb.style.cssText =
      "width:48px;height:36px;flex:0 0 auto;display:flex;align-items:center;justify-content:center;" +
      "background:#000;border-radius:3px;overflow:hidden;font-size:18px;";
    if (meta.thumbnail) {
      const url = URL.createObjectURL(meta.thumbnail);
      objectUrls.push(url);
      const img = document.createElement("img");
      img.src = url;
      img.style.cssText = "max-width:100%;max-height:100%;display:block;";
      thumb.appendChild(img);
    } else {
      thumb.innerHTML = KIND_ICON[meta.kind];
      thumb.style.color = "#9ab";
    }
    row.appendChild(thumb);

    const info = document.createElement("div");
    info.style.cssText = "flex:1 1 auto;min-width:0;";
    const name = document.createElement("div");
    name.textContent = meta.fileName;
    name.style.cssText = "white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
    const size = document.createElement("div");
    size.textContent = formatBytes(meta.size);
    size.style.cssText = "color:#999;font-size:11px;";
    info.appendChild(name);
    info.appendChild(size);
    row.appendChild(info);

    const del = document.createElement("button");
    del.innerHTML = ICON.trash;
    del.title = "削除";
    del.style.cssText = BTN_CSS + "flex:0 0 auto;display:flex;align-items:center;justify-content:center;padding:4px 5px;";
    del.addEventListener("click", (e) => { e.stopPropagation(); void library.remove(meta.id); });
    row.appendChild(del);

    row.addEventListener("dragstart", (e) => {
      e.dataTransfer?.setData("application/x-node-vj-asset", meta.id);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = "copy";
    });

    return row;
  }

  async function addFiles(files: FileList | File[]): Promise<void> {
    for (const file of Array.from(files)) {
      try {
        const m = await library.add(file);
        if (!m) toast(`未対応のファイル: ${file.name}`, true);
      } catch (e) {
        const name = e instanceof Error ? e.name : "";
        if (name === "QuotaExceededError") toast("ストレージ容量を超えました。不要なアセットを削除してください。", true);
        else toast(`追加に失敗: ${file.name}`, true);
        console.warn("[asset-panel] add failed:", e);
      }
    }
  }
  addInput.addEventListener("change", () => {
    if (addInput.files) void addFiles(addInput.files);
    addInput.value = "";
  });

  // OS からのファイル D&D（パネル内容上）
  host.addEventListener("dragover", (e) => {
    if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
  });
  host.addEventListener("drop", (e) => {
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault();
    void addFiles(e.dataTransfer.files);
  });

  library.onChange(() => { void render(); });
  void render();
}
