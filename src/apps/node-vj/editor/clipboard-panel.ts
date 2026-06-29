// #206: クリップボード履歴のサイドパネル内容（DOM・手動 / Playwright 確認）。
// サイドドック（side-dock）に載せ、内容を host に mount するだけ。
// 各項目: クリックで current に再選択（→Cmd+V で貼れる）、ドラッグでエディタにドロップ＝貼り付け。
import type { SidePanelDef } from "./side-dock";
import { CLIP_MIME, type ClipItem, type NodeClipboard } from "./node-clipboard";

const ICON = (body: string): string =>
  `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
  `stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
// クリップボード（書類）アイコン。
const CLIP_ICON = ICON('<rect x="8" y="3" width="8" height="4" rx="1"/><path d="M8 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/>');

/** クリップボードパネルのサイドドック定義。履歴一覧を host に構築する。 */
export function clipboardPanelDef(clipboard: NodeClipboard): SidePanelDef {
  return {
    id: "clipboard",
    title: "クリップボード",
    icon: CLIP_ICON,
    mount: (host) => mountClipboardPanel(host, clipboard),
  };
}

function mountClipboardPanel(host: HTMLElement, clipboard: NodeClipboard): void {
  const listEl = document.createElement("div");
  listEl.style.cssText = "display:flex;flex-direction:column;gap:4px;overflow-y:auto;flex:1 1 auto;";
  host.appendChild(listEl);

  const hint = document.createElement("div");
  hint.textContent = "Cmd+C でコピー → クリックで選択 / Cmd+V or ドラッグで貼付";
  hint.style.cssText = "color:#888;font-size:11px;flex:0 0 auto;line-height:1.4;";
  host.appendChild(hint);

  function render(): void {
    listEl.innerHTML = "";
    const items = clipboard.list();
    const currentId = clipboard.currentItemId();
    if (items.length === 0) {
      const empty = document.createElement("div");
      empty.textContent = "（コピー履歴なし）ノードを選んで Cmd+C";
      empty.style.cssText = "color:#777;padding:6px 2px;";
      listEl.appendChild(empty);
      return;
    }
    for (const item of items) listEl.appendChild(renderRow(item, item.id === currentId));
  }

  function renderRow(item: ClipItem, isCurrent: boolean): HTMLElement {
    const row = document.createElement("div");
    row.draggable = true;
    row.title = "クリックで選択 / ドラッグでエディタへ貼付";
    row.style.cssText =
      "display:flex;align-items:center;gap:6px;padding:5px 7px;border:1px solid #333;border-radius:4px;cursor:grab;" +
      `background:${isCurrent ? "#243042" : "#16161c"};` +
      (isCurrent ? "border-color:#4a6a8a;" : "");

    const info = document.createElement("div");
    info.style.cssText = "flex:1 1 auto;min-width:0;";
    const label = document.createElement("div");
    label.textContent = item.label;
    label.style.cssText = "white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" +
      (isCurrent ? "color:#cfe;font-weight:600;" : "");
    const meta = document.createElement("div");
    const connText = item.connections.length > 0 ? ` ・ ${item.connections.length} 接続` : "";
    meta.textContent = `${item.nodes.length} ノード${connText}`;
    meta.style.cssText = "color:#999;font-size:11px;";
    info.append(label, meta);
    row.appendChild(info);

    if (isCurrent) {
      const badge = document.createElement("span");
      badge.textContent = "● 現在";
      badge.style.cssText = "flex:0 0 auto;font:10px system-ui;color:#7fd1ff;white-space:nowrap;";
      row.appendChild(badge);
    }

    row.addEventListener("click", () => clipboard.setCurrent(item.id));
    row.addEventListener("dragstart", (e) => {
      e.dataTransfer?.setData(CLIP_MIME, item.id);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = "copy";
    });

    return row;
  }

  clipboard.onChange(() => render());
  render();
}
