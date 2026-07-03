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

const BAR_W = 40;
const TOP = 44;     // 上部ツールバーの下
const BOTTOM = 48;  // 下部バーの上
const PANEL_W = 230;

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

/** アクティビティバー + パネル表示領域を body へ追加する。初期は折りたたみ（非表示）。 */
export function buildSideDock(panels: SidePanelDef[], pin: DockPinActions): void {
  let active: string | null = null;
  let pinned = pin.getPinned(); // #228: 前回のピン状態を復元

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
    pinBtn.title = pinned ? "ピン留め中（外側クリックで閉じない）" : "ピン留め（外側クリックで閉じなくする）";
  }
  renderPin();
  const collapseBtn = document.createElement("button");
  collapseBtn.innerHTML = COLLAPSE_ICON;
  collapseBtn.title = "パネルを閉じる";
  collapseBtn.style.cssText = HEADER_BTN;
  const headerBtns = document.createElement("div");
  headerBtns.style.cssText = "display:flex;align-items:center;gap:4px;";
  headerBtns.append(pinBtn, collapseBtn);
  header.append(titleEl, headerBtns);
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
