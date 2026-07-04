// #229: 設定のサイドパネル内容（DOM・手動 / Playwright 確認）。
// サイドドック（side-dock）に載せ、内容を host に mount するだけ。
// #237: 「AI ブリッジ」セクション（WS ブリッジの ON/OFF・URL・接続状態表示）を追加。
import type { SidePanelDef } from "./side-dock";
import type { PanSelectMode } from "./pan-policy";
import type { WsBridgeStatus } from "../api/ws-bridge-client";

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
  // #237: AI ブリッジ（WS）。切替・URL 変更は呼び出し側（main.ts）が即時反映する。
  getWsBridgeEnabled(): boolean;
  setWsBridgeEnabled(enabled: boolean): void;
  getWsBridgeUrl(): string;
  setWsBridgeUrl(url: string): void;
  getWsBridgeStatus(): WsBridgeStatus;
}

/** #237: 接続状態の表示文言と色。 */
export function wsBridgeStatusView(status: WsBridgeStatus): { label: string; color: string } {
  switch (status) {
    case "disabled":
      return { label: "無効", color: "#888" };
    case "connecting":
      return { label: "接続中…", color: "#cb7" };
    case "connected":
      return { label: "接続済", color: "#7c9" };
    case "retrying":
      return { label: "再接続待ち", color: "#c87" };
  }
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

  // #237: AI ブリッジ（WS ブリッジの ON/OFF・URL・接続状態）。
  mountWsBridgeSection(body, actions);

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

/**
 * #237: 「AI ブリッジ」セクション。ローカル中継（bun run relay）経由で外部の
 * AI エージェントからグラフを操作できるようにする WS 接続の ON/OFF・URL・状態表示。
 */
function mountWsBridgeSection(body: HTMLElement, actions: SettingsPanelActions): void {
  const section = document.createElement("div");
  section.textContent = "AI ブリッジ";
  section.style.cssText = "color:#9ab;font-size:11px;font-weight:600;padding:8px 2px 0;";
  body.appendChild(section);

  // ON/OFF トグル＋接続状態（1 行）。
  const row = document.createElement("div");
  row.style.cssText = "display:flex;align-items:center;gap:8px;padding:2px 2px 0;";
  const toggle = document.createElement("button");
  toggle.style.cssText =
    "padding:4px 10px;border:1px solid #333;border-radius:4px;cursor:pointer;" +
    "background:#16161c;color:#ddd;font:12px system-ui;font-weight:600;";
  const status = document.createElement("span");
  status.style.cssText = "font-size:11px;";
  row.append(toggle, status);
  body.appendChild(row);

  // 中継サーバ URL。
  const urlInput = document.createElement("input");
  urlInput.type = "text";
  urlInput.placeholder = "ws://localhost:8787";
  urlInput.title = "中継サーバの URL（bun run relay で起動）";
  urlInput.style.cssText =
    "padding:4px 6px;border:1px solid #333;border-radius:4px;background:#101014;color:#ddd;" +
    "font:11px ui-monospace,monospace;width:100%;box-sizing:border-box;";
  urlInput.value = actions.getWsBridgeUrl();
  urlInput.addEventListener("change", () => {
    const url = urlInput.value.trim();
    if (url === "") {
      urlInput.value = actions.getWsBridgeUrl(); // 空は無効（現在値へ戻す）
      return;
    }
    actions.setWsBridgeUrl(url);
  });
  body.appendChild(urlInput);

  const desc = document.createElement("div");
  desc.textContent = "外部の AI エージェントがローカル中継（bun run relay）経由でグラフを操作できます";
  desc.style.cssText = "color:#999;font-size:11px;line-height:1.4;padding:0 2px;";
  body.appendChild(desc);

  function render(): void {
    const enabled = actions.getWsBridgeEnabled();
    toggle.textContent = enabled ? "ON" : "OFF";
    toggle.style.background = enabled ? "#243042" : "#16161c";
    toggle.style.borderColor = enabled ? "#4a6a8a" : "#333";
    toggle.style.color = enabled ? "#cfe" : "#ddd";
    const view = wsBridgeStatusView(actions.getWsBridgeStatus());
    status.textContent = view.label;
    status.style.color = view.color;
  }
  toggle.addEventListener("click", () => {
    actions.setWsBridgeEnabled(!actions.getWsBridgeEnabled());
    render();
  });
  // 接続状態は自動リトライ等で外から変わるため 1s ポーリングで追従する。
  setInterval(render, 1000);
  render();
}
