// #229: 設定のサイドパネル内容（DOM・手動 / Playwright 確認）。
// サイドドック（side-dock）に載せ、内容を host に mount するだけ。
// #237: 「AI ブリッジ」セクション（WS ブリッジの ON/OFF・URL・接続状態表示）を追加。
// #244: 「言語 / Language」セクション（ja/en の 2 択・保存後にリロードで反映）を追加。
import type { SidePanelDef } from "./side-dock";
import type { PanSelectMode } from "./pan-policy";
import type { WsBridgeStatus } from "../api/ws-bridge-client";
import { t, type Lang, type MsgKey } from "../i18n";

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
  // #244: UI 言語。set 側は prefs 保存 → location.reload()（呼び出し側 main.ts）。
  getLang(): Lang;
  setLang(lang: Lang): void;
}

/** #237: 接続状態の表示文言と色。 */
export function wsBridgeStatusView(status: WsBridgeStatus): { label: string; color: string } {
  switch (status) {
    case "disabled":
      return { label: t("settings.aiBridge.status.disabled"), color: "#888" };
    case "connecting":
      return { label: t("settings.aiBridge.status.connecting"), color: "#cb7" };
    case "connected":
      return { label: t("settings.aiBridge.status.connected"), color: "#7c9" };
    case "retrying":
      return { label: t("settings.aiBridge.status.retrying"), color: "#c87" };
  }
}

/** 操作モードの選択肢（表示名と説明はカタログキーで保持し、mount 時に t() で解決する）。 */
const PAN_MODE_OPTIONS: { mode: PanSelectMode; labelKey: MsgKey; descKey: MsgKey }[] = [
  { mode: "modern", labelKey: "settings.panMode.modern", descKey: "settings.panMode.modern.desc" },
  { mode: "legacy", labelKey: "settings.panMode.legacy", descKey: "settings.panMode.legacy.desc" },
];

/** #244: 言語の選択肢（言語名は各言語の自称で固定表示・翻訳しない）。 */
const LANG_OPTIONS: { lang: Lang; label: string }[] = [
  { lang: "ja", label: "日本語" },
  { lang: "en", label: "English" },
];

/** 設定パネルのサイドドック定義。 */
export function settingsPanelDef(actions: SettingsPanelActions): SidePanelDef {
  return {
    id: "settings",
    title: t("panel.settings"),
    icon: GEAR_ICON,
    mount: (host) => mountSettingsPanel(host, actions),
  };
}

function mountSettingsPanel(host: HTMLElement, actions: SettingsPanelActions): void {
  const body = document.createElement("div");
  body.style.cssText = "display:flex;flex-direction:column;gap:6px;overflow-y:auto;flex:1 1 auto;";
  host.appendChild(body);

  const section = document.createElement("div");
  section.textContent = t("settings.section.panSelect");
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
    label.textContent = t(opt.labelKey);
    label.style.cssText = "font-weight:600;";
    const desc = document.createElement("div");
    desc.textContent = t(opt.descKey);
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

  // #244: 言語 / Language（保存 → リロードで反映）。
  mountLanguageSection(body, actions);

  const hint = document.createElement("div");
  hint.textContent = t("settings.hint");
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
  section.textContent = t("settings.section.aiBridge");
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
  urlInput.title = t("settings.aiBridge.urlTitle");
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
  desc.textContent = t("settings.aiBridge.desc");
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

/**
 * #244: 「言語 / Language」セクション。操作モードと同じ 2 択ボタン UI。
 * クリックで actions.setLang（prefs 保存 → location.reload は呼び出し側）が走るため、
 * 選択後の再ハイライトは不要（リロードで再構築される）が、保険で render する。
 */
function mountLanguageSection(body: HTMLElement, actions: SettingsPanelActions): void {
  const section = document.createElement("div");
  section.textContent = t("settings.section.language");
  section.style.cssText = "color:#9ab;font-size:11px;font-weight:600;padding:8px 2px 0;";
  body.appendChild(section);

  const rows = new Map<Lang, HTMLElement>();
  for (const opt of LANG_OPTIONS) {
    const row = document.createElement("button");
    row.style.cssText =
      "display:flex;flex-direction:column;align-items:flex-start;gap:2px;padding:6px 8px;" +
      "border:1px solid #333;border-radius:4px;cursor:pointer;text-align:left;" +
      "background:#16161c;color:#ddd;font:12px system-ui;";
    const label = document.createElement("div");
    label.textContent = opt.label;
    label.style.cssText = "font-weight:600;";
    const desc = document.createElement("div");
    // 切替でページを再読み込みすることを明記する（ユーザ決定・ライブ再構築はしない）。
    desc.textContent = t("settings.lang.reloadNote");
    desc.style.cssText = "color:#999;font-size:11px;line-height:1.4;";
    row.append(label, desc);
    row.addEventListener("click", () => {
      if (opt.lang === actions.getLang()) return; // 同じ言語なら何もしない（無駄なリロード防止）
      actions.setLang(opt.lang);
      render();
    });
    body.appendChild(row);
    rows.set(opt.lang, row);
  }

  // 現在値の行をハイライトする（操作モードと同じ表現）。
  function render(): void {
    const current = actions.getLang();
    for (const [lang, row] of rows) {
      const on = lang === current;
      row.style.background = on ? "#243042" : "#16161c";
      row.style.borderColor = on ? "#4a6a8a" : "#333";
      (row.firstChild as HTMLElement).style.color = on ? "#cfe" : "#ddd";
    }
  }
  render();
}
