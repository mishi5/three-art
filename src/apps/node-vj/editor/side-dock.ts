// #151: VSCode 風サイドドック。最左のアクティビティバー（アイコン列）で
// パネルを切り替え、その右に選択中パネルの内容を 1 枚だけ表示する。
// 各パネルは内容を host へ mount するだけで、ドックがバー/ヘッダ/開閉を提供する。
// #258: 左右対応（side: "left" | "right"）。右ドックはバーが画面右端・パネルがその左（鏡像）。
import { t } from "../i18n";

export interface SidePanelDef {
  id: string;
  title: string;
  icon: string;                 // インライン SVG 文字列（currentColor）
  accent?: string;              // #259: パネルの識別色（未指定は従来表示）
  mount(host: HTMLElement): void; // 内容を host に構築（1 度だけ呼ばれる）
  /** #258: パネルが非表示になったとき（別パネル切替・collapse・自動クローズ）。任意。 */
  onHide?(): void;
}

/** クリックされたパネルに応じた次のアクティブ ID。アクティブを再クリックなら閉じる（null）。純関数。 */
export function nextActivePanel(current: string | null, clicked: string): string | null {
  return current === clicked ? null : clicked;
}

// #259: パネルごとのアクセントカラーをアクティビティバー / ヘッダへ反映する純関数。

/**
 * アクティビティバーのアイコンボタンの配色（全パネル共通のグレー系）。
 * #259 の実機確認で「一部アイコンだけ色付きは違和感・グリフで判別できるので色は不要」との
 * フィードバックを受け、アイコン自体の着色はしない（パネルの識別色はヘッダ下線と行側で表現）。
 */
export function activityButtonStyle(on: boolean): { background: string; color: string } {
  if (!on) return { background: "transparent", color: "#9ab" };
  return { background: "#243042", color: "#cfe" };
}

/** パネルヘッダの下線。accent 未指定は透明（高さを揺らさず従来表示のまま）。 */
export function headerUnderline(accent?: string): string {
  return `2px solid ${accent ?? "transparent"}`;
}

/** #228: ピン状態の読み書き（prefs への永続化は呼び出し側・settings-panel の actions と同パターン）。 */
export interface DockPinActions {
  getPinned(): boolean;
  setPinned(pinned: boolean): void;
}

/** #228: 外側 pointerdown での自動クローズ判定の入力。 */
export interface AutoCloseInput {
  pinned: boolean;       // ピン留め中か
  paneOpen: boolean;     // パネルが開いているか
  targetInBar: boolean;  // 対象がアクティビティバー内か（アイコンのトグルに委ねる）
  targetInPane: boolean; // 対象がパネル内か（パネル内操作で誤クローズしない）
}

/** #228: パネル外 pointerdown でパネルを自動で閉じるべきか。純関数。 */
export function shouldAutoClose(input: AutoCloseInput): boolean {
  return input.paneOpen && !input.pinned && !input.targetInBar && !input.targetInPane;
}

// #243: ノード追加パネルが「見えている範囲」（ドック右端〜画面端）を計算するため export する。
export const BAR_W = 40;
export const TOP = 44;     // 上部ツールバーの下
const BOTTOM = 0;          // #230: 下部バー撤去に伴い最下端まで使う
export const PANEL_W = 230;

/** #258: ドックの取り付け側。 */
export type DockSide = "left" | "right";

/**
 * #258: side に応じたバー/パネルの配置 CSS 断片（純関数）。
 * left は従来配置（バー左端・パネルはバーの右）、right はその鏡像。
 */
export function dockPlacement(side: DockSide): { bar: string; pane: string } {
  if (side === "right") {
    return {
      bar: "right:0;border-left:1px solid #333;",
      pane:
        `right:${BAR_W}px;border-left:1px solid #444;border-radius:6px 0 0 6px;` +
        "box-shadow:-2px 0 16px rgba(0,0,0,0.4);",
    };
  }
  return {
    bar: "left:0;border-right:1px solid #333;",
    pane:
      `left:${BAR_W}px;border-right:1px solid #444;border-radius:0 6px 6px 0;` +
      "box-shadow:2px 0 16px rgba(0,0,0,0.4);",
  };
}

/** #258: ドックの外部操作ハンドル（エッジドロップからのプログラム的オープン等）。 */
export interface SideDockHandle {
  /** 指定パネルを開く（既に開いていれば何もしない）。 */
  open(id: string): void;
  /** パネルを閉じる（バーは残る）。 */
  close(): void;
  /** 現在開いているパネル id（閉じていれば null）。 */
  activeId(): string | null;
}

/** #258: buildSideDock のオプション。 */
export interface SideDockOptions {
  /** 取り付け側。既定 "left"（従来）。 */
  side?: DockSide;
  /** 開閉・パネル切替のたびに呼ぶ（PiP 等のレイアウト追随用）。 */
  onActiveChange?(id: string | null): void;
}

const COLLAPSE_ICON =
  `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
  `stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">` +
  `<polyline points="13 6 7 12 13 18"/><polyline points="18 6 12 12 18 18"/></svg>`;

// #228: ピンアイコン（画鋲）。ON 時はハイライト色で塗り分ける。
const PIN_ICON =
  `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
  `stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">` +
  `<path d="M12 17v5"/>` +
  `<path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12` +
  `a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1` +
  ` 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>`;

const ACTIVITY_BTN =
  "width:32px;height:32px;display:flex;align-items:center;justify-content:center;" +
  "background:transparent;color:#9ab;border:none;border-radius:6px;cursor:pointer;padding:0;";

/**
 * アクティビティバー + パネル表示領域を body へ追加する。初期は折りたたみ（非表示）。
 * #258: options.side で左右を選べる（既定 left・従来配置）。戻り値のハンドルで外部から開閉できる。
 */
export function buildSideDock(
  panels: SidePanelDef[],
  pin: DockPinActions,
  options?: SideDockOptions,
): SideDockHandle {
  let active: string | null = null;
  let pinned = pin.getPinned(); // #228: 前回のピン状態を復元
  const placement = dockPlacement(options?.side ?? "left");

  const bar = document.createElement("div");
  bar.style.cssText =
    `position:fixed;${placement.bar}top:${TOP}px;bottom:${BOTTOM}px;width:${BAR_W}px;z-index:158;` +
    "display:flex;flex-direction:column;align-items:center;gap:4px;padding-top:6px;box-sizing:border-box;" +
    "background:rgba(16,16,20,0.96);";

  const pane = document.createElement("div");
  // #258: パネル側から「ペイン外クリック」を判定できるよう目印を付ける（node-add-panel のフィルタ解除）。
  pane.dataset.role = "dock-pane";
  pane.style.cssText =
    `position:fixed;${placement.pane}top:${TOP}px;bottom:${BOTTOM}px;width:${PANEL_W}px;z-index:157;` +
    "display:none;flex-direction:column;gap:6px;padding:8px;box-sizing:border-box;" +
    "background:rgba(20,20,26,0.96);border-top:1px solid #444;" +
    "font:12px system-ui;color:#ddd;";

  const header = document.createElement("div");
  header.style.cssText =
    "display:flex;align-items:center;justify-content:space-between;flex:0 0 auto;padding-bottom:5px;";
  // #259: タイトル左にパネルアイコン（accent 色）。どのパネルを開いているか一目で分かるようにする。
  const headerIcon = document.createElement("span");
  headerIcon.style.cssText = "display:flex;align-items:center;flex:0 0 auto;";
  const titleEl = document.createElement("span");
  titleEl.style.cssText = "font-weight:600;";
  const headerLeft = document.createElement("div");
  headerLeft.style.cssText = "display:flex;align-items:center;gap:6px;min-width:0;";
  headerLeft.append(headerIcon, titleEl);
  const HEADER_BTN =
    "background:#1c1c22;color:#ddd;border:1px solid #444;border-radius:4px;cursor:pointer;" +
    "display:flex;align-items:center;justify-content:center;padding:3px 6px;";
  // #228: ピン留めトグル。ON 中は外側クリックで自動クローズしない。
  const pinBtn = document.createElement("button");
  pinBtn.innerHTML = PIN_ICON;
  pinBtn.style.cssText = HEADER_BTN;
  pinBtn.addEventListener("click", () => {
    pinned = !pinned;
    pin.setPinned(pinned); // prefs へ永続化（再読込後も保持）
    renderPin();
  });
  // ピンの ON/OFF を背景・文字色で塗り分ける（アクティビティボタンと同じ表現）。
  function renderPin(): void {
    pinBtn.style.background = pinned ? "#243042" : "#1c1c22";
    pinBtn.style.color = pinned ? "#cfe" : "#889";
    pinBtn.style.borderColor = pinned ? "#4a6a8a" : "#444";
    pinBtn.title = pinned ? t("dock.pin.on") : t("dock.pin.off");
  }
  renderPin();
  const collapseBtn = document.createElement("button");
  collapseBtn.innerHTML = COLLAPSE_ICON;
  collapseBtn.title = t("dock.collapse");
  collapseBtn.style.cssText = HEADER_BTN;
  const headerBtns = document.createElement("div");
  headerBtns.style.cssText = "display:flex;align-items:center;gap:4px;";
  headerBtns.append(pinBtn, collapseBtn);
  header.append(headerLeft, headerBtns);
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

  // #228: パネル外の pointerdown で自動クローズ（capture・NodeEditor の closeOnOutside #166 と同パターン）。
  // bar 内はアイコンのトグルに、pane 内はパネル内操作に委ねる。ピン中は無視。
  document.addEventListener(
    "pointerdown",
    (e) => {
      const t = e.target as Node;
      const close = shouldAutoClose({
        pinned,
        paneOpen: active !== null,
        targetInBar: bar.contains(t),
        targetInPane: pane.contains(t),
      });
      if (close) setActive(null);
    },
    true,
  );

  function setActive(id: string | null): void {
    const prev = active;
    active = id;
    pane.style.display = id ? "flex" : "none";
    for (const [pid, host] of hosts) host.style.display = pid === id ? "flex" : "none";
    const def = panels.find((p) => p.id === id);
    for (const [pid, btn] of iconButtons) {
      const s = activityButtonStyle(pid === id);
      btn.style.background = s.background;
      btn.style.color = s.color;
    }
    // #259: ヘッダはアイコン（グレー）＋アクセント下線。accent 未指定パネルは従来表示。
    // アイコン自体は着色しない（識別色は下線と行側で表現・実機フィードバック反映）。
    titleEl.textContent = def ? def.title : "";
    headerIcon.innerHTML = def ? def.icon : "";
    headerIcon.style.color = "#9ab";
    header.style.borderBottom = headerUnderline(def?.accent);
    // #258: 非表示になったパネルへ通知（node-add のフィルタ解除等）。開閉変化を外部にも通知。
    if (prev !== id) {
      if (prev !== null) panels.find((p) => p.id === prev)?.onHide?.();
      options?.onActiveChange?.(id);
    }
  }

  setActive(null); // 初期は折りたたみ

  return {
    open: (id) => { if (active !== id) setActive(id); },
    close: () => setActive(null),
    activeId: () => active,
  };
}
