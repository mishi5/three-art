// #151: VSCode 風サイドドック。最左のアクティビティバー（アイコン列）で
// パネルを切り替え、その右に選択中パネルの内容を 1 枚だけ表示する。
// 各パネルは内容を host へ mount するだけで、ドックがバー/ヘッダ/開閉を提供する。

export interface SidePanelDef {
  id: string;
  title: string;
  icon: string;                 // インライン SVG 文字列（currentColor）
  mount(host: HTMLElement): void; // 内容を host に構築（1 度だけ呼ばれる）
}

/** クリックされたパネルに応じた次のアクティブ ID。アクティブを再クリックなら閉じる（null）。純関数。 */
export function nextActivePanel(current: string | null, clicked: string): string | null {
  return current === clicked ? null : clicked;
}

const BAR_W = 40;
const TOP = 44;     // 上部ツールバーの下
const BOTTOM = 48;  // 下部バーの上
const PANEL_W = 230;

const COLLAPSE_ICON =
  `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
  `stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">` +
  `<polyline points="13 6 7 12 13 18"/><polyline points="18 6 12 12 18 18"/></svg>`;

const ACTIVITY_BTN =
  "width:32px;height:32px;display:flex;align-items:center;justify-content:center;" +
  "background:transparent;color:#9ab;border:none;border-radius:6px;cursor:pointer;padding:0;";

/** アクティビティバー + パネル表示領域を body へ追加する。初期は折りたたみ（非表示）。 */
export function buildSideDock(panels: SidePanelDef[]): void {
  let active: string | null = null;

  const bar = document.createElement("div");
  bar.style.cssText =
    `position:fixed;left:0;top:${TOP}px;bottom:${BOTTOM}px;width:${BAR_W}px;z-index:158;` +
    "display:flex;flex-direction:column;align-items:center;gap:4px;padding-top:6px;box-sizing:border-box;" +
    "background:rgba(16,16,20,0.96);border-right:1px solid #333;";

  const pane = document.createElement("div");
  pane.style.cssText =
    `position:fixed;left:${BAR_W}px;top:${TOP}px;bottom:${BOTTOM}px;width:${PANEL_W}px;z-index:157;` +
    "display:none;flex-direction:column;gap:6px;padding:8px;box-sizing:border-box;" +
    "background:rgba(20,20,26,0.96);border-right:1px solid #444;border-top:1px solid #444;" +
    "border-radius:0 6px 6px 0;font:12px system-ui;color:#ddd;box-shadow:2px 0 16px rgba(0,0,0,0.4);";

  const header = document.createElement("div");
  header.style.cssText = "display:flex;align-items:center;justify-content:space-between;flex:0 0 auto;";
  const titleEl = document.createElement("span");
  titleEl.style.cssText = "font-weight:600;";
  const collapseBtn = document.createElement("button");
  collapseBtn.innerHTML = COLLAPSE_ICON;
  collapseBtn.title = "パネルを閉じる";
  collapseBtn.style.cssText =
    "background:#1c1c22;color:#ddd;border:1px solid #444;border-radius:4px;cursor:pointer;" +
    "display:flex;align-items:center;justify-content:center;padding:3px 6px;";
  header.append(titleEl, collapseBtn);
  pane.appendChild(header);

  const iconButtons = new Map<string, HTMLButtonElement>();
  const hosts = new Map<string, HTMLElement>();

  for (const panel of panels) {
    const btn = document.createElement("button");
    btn.innerHTML = panel.icon;
    btn.title = panel.title;
    btn.style.cssText = ACTIVITY_BTN;
    btn.addEventListener("click", () => setActive(nextActivePanel(active, panel.id)));
    bar.appendChild(btn);
    iconButtons.set(panel.id, btn);

    const host = document.createElement("div");
    host.style.cssText = "display:none;flex-direction:column;gap:6px;flex:1 1 auto;min-height:0;overflow:hidden;";
    panel.mount(host);
    pane.appendChild(host);
    hosts.set(panel.id, host);
  }

  collapseBtn.addEventListener("click", () => setActive(null));
  document.body.appendChild(bar);
  document.body.appendChild(pane);

  function setActive(id: string | null): void {
    active = id;
    pane.style.display = id ? "flex" : "none";
    for (const [pid, host] of hosts) host.style.display = pid === id ? "flex" : "none";
    for (const [pid, btn] of iconButtons) {
      const on = pid === id;
      btn.style.background = on ? "#243042" : "transparent";
      btn.style.color = on ? "#cfe" : "#9ab";
    }
    const def = panels.find((p) => p.id === id);
    titleEl.textContent = def ? def.title : "";
  }

  setActive(null); // 初期は折りたたみ
}
