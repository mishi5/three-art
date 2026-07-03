// #229: 設定のサイドパネル内容（DOM・手動 / Playwright 確認）。
// サイドドック（side-dock）に載せ、内容を host に mount するだけ。
// 現在は「パン / 矩形選択の操作モード」のみ。設定項目が増えたらセクションを足す。
import type { SidePanelDef } from "./side-dock";
import type { PanSelectMode } from "./pan-policy";

const ICON = (body: string): string =>
  `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
  `stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
// 歯車アイコン。
const GEAR_ICON = ICON(
  '<circle cx="12" cy="12" r="3"/>' +
  '<path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.03-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.56-1.03 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.01a1.7 1.7 0 0 0 1.02-1.56V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.01a1.7 1.7 0 0 0 1.56 1.02H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.56 1.03z"/>',
);

/** 設定パネルが操作する値の読み書き（prefs 保存と NodeEditor への即反映は呼び出し側）。 */
export interface SettingsPanelActions {
  getPanMode(): PanSelectMode;
  setPanMode(mode: PanSelectMode): void;
}

/** 操作モードの選択肢（表示名と説明）。 */
const PAN_MODE_OPTIONS: { mode: PanSelectMode; label: string; desc: string }[] = [
  {
    mode: "modern",
    label: "標準",
    desc: "空白ドラッグ＝パン / Shift+ドラッグ＝矩形選択",
  },
  {
    mode: "legacy",
    label: "クラシック",
    desc: "空白ドラッグ＝矩形選択 / パンは Space+ドラッグ・中/右ボタン",
  },
];

/** 設定パネルのサイドドック定義。 */
export function settingsPanelDef(actions: SettingsPanelActions): SidePanelDef {
  return {
    id: "settings",
    title: "設定",
    icon: GEAR_ICON,
    mount: (host) => mountSettingsPanel(host, actions),
  };
}

function mountSettingsPanel(host: HTMLElement, actions: SettingsPanelActions): void {
  const body = document.createElement("div");
  body.style.cssText = "display:flex;flex-direction:column;gap:6px;overflow-y:auto;flex:1 1 auto;";
  host.appendChild(body);

  const section = document.createElement("div");
  section.textContent = "パン / 矩形選択の操作";
  section.style.cssText = "color:#9ab;font-size:11px;font-weight:600;padding:2px 2px 0;";
  body.appendChild(section);

  const rows = new Map<PanSelectMode, HTMLElement>();
  for (const opt of PAN_MODE_OPTIONS) {
    const row = document.createElement("button");
    row.style.cssText =
      "display:flex;flex-direction:column;align-items:flex-start;gap:2px;padding:6px 8px;" +
      "border:1px solid #333;border-radius:4px;cursor:pointer;text-align:left;" +
      "background:#16161c;color:#ddd;font:12px system-ui;";
    const label = document.createElement("div");
    label.textContent = opt.label;
    label.style.cssText = "font-weight:600;";
    const desc = document.createElement("div");
    desc.textContent = opt.desc;
    desc.style.cssText = "color:#999;font-size:11px;line-height:1.4;";
    row.append(label, desc);
    row.addEventListener("click", () => {
      actions.setPanMode(opt.mode);
      render();
    });
    body.appendChild(row);
    rows.set(opt.mode, row);
  }

  const hint = document.createElement("div");
  hint.textContent = "切替は即時反映・再読込後も保持されます";
  hint.style.cssText = "color:#888;font-size:11px;flex:0 0 auto;line-height:1.4;";
  host.appendChild(hint);

  // 現在値の行をハイライトする。
  function render(): void {
    const current = actions.getPanMode();
    for (const [mode, row] of rows) {
      const on = mode === current;
      row.style.background = on ? "#243042" : "#16161c";
      row.style.borderColor = on ? "#4a6a8a" : "#333";
      (row.firstChild as HTMLElement).style.color = on ? "#cfe" : "#ddd";
    }
  }
  render();
}
