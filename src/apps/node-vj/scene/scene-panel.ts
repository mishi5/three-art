// #151: シーン一覧パネルの内容（DOM・手動 / Playwright 確認）。
// サイドドック（editor/side-dock）に載せ、内容を host に mount するだけ。
// アクションは main から注入する。純関数 panelDisplay はテスト対象。
import type { Scene } from "./scene-store";
import type { SidePanelDef } from "../editor/side-dock";

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

const BTN_CSS =
  "background:#1c1c22;color:#ddd;border:1px solid #444;border-radius:4px;padding:4px 8px;cursor:pointer;font:12px system-ui;";

const ICON = (body: string): string =>
  `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
  `stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const SCENES_ICON = ICON('<rect x="3" y="4" width="14" height="14" rx="2"/><path d="M21 7v13H8"/>');
const DUP_ICON = ICON('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>');
const TRASH_ICON = ICON('<polyline points="4 7 20 7"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/>');

/** シーンパネルのサイドドック定義を返す。一覧/追加を host に構築する。 */
export function scenePanelDef(actions: ScenePanelActions): SidePanelDef {
  return {
    id: "scene",
    title: "シーン",
    icon: SCENES_ICON,
    mount: (host) => mountScenePanel(host, actions),
  };
}

function mountScenePanel(host: HTMLElement, actions: ScenePanelActions): void {
  const listEl = document.createElement("div");
  listEl.style.cssText = "display:flex;flex-direction:column;gap:4px;overflow-y:auto;flex:1 1 auto;";
  host.appendChild(listEl);

  const addBtn = document.createElement("button");
  addBtn.textContent = "＋ シーン追加";
  addBtn.style.cssText = BTN_CSS + "text-align:center;flex:0 0 auto;";
  addBtn.addEventListener("click", () => actions.add());
  host.appendChild(addBtn);

  function render(): void {
    listEl.innerHTML = "";
    const activeId = actions.activeId();
    const scenes = actions.list();
    for (const scene of scenes) listEl.appendChild(renderRow(scene, scene.id === activeId, scenes.length));
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
}
