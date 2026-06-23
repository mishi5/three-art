// #151: シーン一覧の左ドックパネル（DOM・手動 / Playwright 確認）。
// アクションは main から注入し、パネルは表示と操作呼び出しのみ担う。純関数 panelDisplay はテスト対象。
import type { Scene } from "./scene-store";

export function panelDisplay(open: boolean): "flex" | "none" { return open ? "flex" : "none"; }

export interface ScenePanelActions {
  list(): Scene[];
  activeId(): string;
  switchTo(id: string): void;
  add(): void;
  duplicate(id: string): void;
  remove(id: string): void;
  rename(id: string, name: string): void;
  onChange(cb: () => void): () => void;
}

const PANEL_BG = "rgba(20,20,26,0.96)";
const BTN_CSS =
  "background:#1c1c22;color:#ddd;border:1px solid #444;border-radius:4px;padding:4px 8px;cursor:pointer;font:12px system-ui;";
const PANE_TOP = 44;
const RAIL_TOP = 84; // アセットのレール（top:44）と縦に重ねない

const ICON = (body: string): string =>
  `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
  `stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const SCENES_ICON = ICON('<rect x="3" y="4" width="14" height="14" rx="2"/><path d="M21 7v13H8"/>');
const COLLAPSE_ICON = ICON('<polyline points="13 6 7 12 13 18"/><polyline points="18 6 12 12 18 18"/>');
const DUP_ICON = ICON('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>');
const TRASH_ICON = ICON('<polyline points="4 7 20 7"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/>');

/** シーン一覧の左ドックパネルを構築して body へ追加する。初期は折りたたみ（レール表示）。 */
export function buildScenePanel(actions: ScenePanelActions): HTMLElement {
  let open = false;

  const rail = document.createElement("button");
  rail.innerHTML = SCENES_ICON;
  rail.title = "シーンパネルを開く";
  rail.style.cssText = BTN_CSS + `position:fixed;left:0;top:${RAIL_TOP}px;z-index:157;border-radius:0 6px 6px 0;` +
    `display:${open ? "none" : "flex"};align-items:center;justify-content:center;padding:8px 7px;`;
  document.body.appendChild(rail);

  const pane = document.createElement("div");
  pane.style.cssText =
    `position:fixed;left:0;top:${PANE_TOP}px;bottom:48px;width:230px;` +
    `display:${panelDisplay(open)};flex-direction:column;gap:6px;z-index:157;` +
    `background:${PANEL_BG};border-right:1px solid #444;border-top:1px solid #444;` +
    `border-radius:0 6px 6px 0;padding:8px;box-sizing:border-box;font:12px system-ui;color:#ddd;` +
    `box-shadow:2px 0 16px rgba(0,0,0,0.4);`;

  const header = document.createElement("div");
  header.style.cssText = "display:flex;align-items:center;justify-content:space-between;flex:0 0 auto;";
  const title = document.createElement("span"); title.textContent = "シーン"; title.style.cssText = "font-weight:600;";
  const collapseBtn = document.createElement("button");
  collapseBtn.innerHTML = COLLAPSE_ICON; collapseBtn.title = "閉じる";
  collapseBtn.style.cssText = BTN_CSS + "display:flex;align-items:center;justify-content:center;padding:3px 6px;";
  header.append(title, collapseBtn);
  pane.appendChild(header);

  const listEl = document.createElement("div");
  listEl.style.cssText = "display:flex;flex-direction:column;gap:4px;overflow-y:auto;flex:1 1 auto;";
  pane.appendChild(listEl);

  const addBtn = document.createElement("button");
  addBtn.textContent = "＋ シーン追加";
  addBtn.style.cssText = BTN_CSS + "text-align:center;flex:0 0 auto;";
  addBtn.addEventListener("click", () => actions.add());
  pane.appendChild(addBtn);

  document.body.appendChild(pane);

  function setOpen(next: boolean): void {
    open = next;
    pane.style.display = panelDisplay(open);
    rail.style.display = open ? "none" : "flex";
  }
  collapseBtn.addEventListener("click", () => setOpen(false));
  rail.addEventListener("click", () => setOpen(true));

  function render(): void {
    listEl.innerHTML = "";
    const activeId = actions.activeId();
    const scenes = actions.list();
    for (const scene of scenes) {
      listEl.appendChild(renderRow(scene, scene.id === activeId, scenes.length));
    }
  }

  function renderRow(scene: Scene, isActive: boolean, count: number): HTMLElement {
    const row = document.createElement("div");
    row.style.cssText =
      "display:flex;align-items:center;gap:6px;padding:4px 6px;border:1px solid #333;border-radius:4px;cursor:pointer;" +
      `background:${isActive ? "#243042" : "#16161c"};`;

    const name = document.createElement("div");
    name.textContent = scene.name;
    name.style.cssText = "flex:1 1 auto;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" +
      (isActive ? "color:#cfe;font-weight:600;" : "");
    row.appendChild(name);

    row.addEventListener("click", () => actions.switchTo(scene.id));

    name.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      const input = document.createElement("input");
      input.value = scene.name;
      input.style.cssText = "flex:1 1 auto;min-width:0;background:#111;color:#ddd;border:1px solid #4a5566;border-radius:3px;padding:2px 4px;";
      const commit = (): void => { const v = input.value.trim(); if (v) actions.rename(scene.id, v); else render(); };
      input.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") { ev.preventDefault(); commit(); }
        else if (ev.key === "Escape") { ev.preventDefault(); render(); }
      });
      input.addEventListener("blur", commit);
      input.addEventListener("click", (ev) => ev.stopPropagation());
      row.replaceChild(input, name);
      input.focus(); input.select();
    });

    const dup = document.createElement("button");
    dup.innerHTML = DUP_ICON; dup.title = "複製";
    dup.style.cssText = BTN_CSS + "flex:0 0 auto;display:flex;align-items:center;justify-content:center;padding:3px 5px;";
    dup.addEventListener("click", (e) => { e.stopPropagation(); actions.duplicate(scene.id); });
    row.appendChild(dup);

    const del = document.createElement("button");
    del.innerHTML = TRASH_ICON; del.title = count <= 1 ? "最後の 1 シーンは削除できません" : "削除";
    del.disabled = count <= 1;
    del.style.cssText = BTN_CSS + "flex:0 0 auto;display:flex;align-items:center;justify-content:center;padding:3px 5px;" +
      (count <= 1 ? "opacity:0.4;cursor:not-allowed;" : "");
    del.addEventListener("click", (e) => { e.stopPropagation(); if (count > 1) actions.remove(scene.id); });
    row.appendChild(del);

    return row;
  }

  actions.onChange(() => render());
  render();
  return pane;
}
