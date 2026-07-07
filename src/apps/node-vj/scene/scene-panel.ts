// #151: シーン一覧パネルの内容（DOM・手動 / Playwright 確認）。
// サイドドック（editor/side-dock）に載せ、内容を host に mount するだけ。
// アクションは main から注入する。純関数 panelDisplay はテスト対象。
import type { Scene } from "./scene-store";
import type { SidePanelDef } from "../editor/side-dock";
import { effectiveOutputSceneId, isFollowingEdit } from "./output-scene";
import { t } from "../i18n";

export function panelDisplay(open: boolean): "flex" | "none" { return open ? "flex" : "none"; }

// #255: シーン名編集中に自動保存の onChange がリストを作り直して <input> を壊すため、
// 編集中の再描画要求は dirty として保留し、編集終了時に flush する小さな状態機械。
export interface RenderHold {
  /** 編集開始。以後 request() は保留される。 */
  beginEdit(): void;
  /** 編集終了。保留があれば render を 1 回 flush する。 */
  endEdit(): void;
  /** 再描画要求。編集中なら dirty を立てるだけ、非編集中は即 render。 */
  request(): void;
  /** 編集中かどうか。 */
  editing(): boolean;
}

export function createRenderHold(render: () => void): RenderHold {
  let editing = false;
  let dirty = false;
  return {
    beginEdit() { editing = true; },
    endEdit() {
      editing = false;
      if (dirty) { dirty = false; render(); }
    },
    request() {
      if (editing) { dirty = true; return; }
      render();
    },
    editing() { return editing; },
  };
}

export interface ScenePanelActions {
  list(): Scene[];
  activeId(): string;
  switchTo(id: string): void;
  // #245: name 省略時は "Scene N"。作成したシーンを返す（AI API が sceneId を使う。UI は戻り値を無視）。
  add(name?: string): Scene;
  duplicate(id: string): void;
  remove(id: string): void;
  rename(id: string, name: string): void;
  onChange(cb: () => void): () => void;
  // #174: 出力シーン（編集と分離）。null は編集に追従。
  outputId(): string | null;
  setOutput(id: string | null): void;
}

const BTN_CSS =
  "background:#1c1c22;color:#ddd;border:1px solid #444;border-radius:4px;padding:4px 8px;cursor:pointer;font:12px system-ui;";

// #259: シーンパネルのアクセントカラー（青系）。アセットパネル（琥珀系）との視覚差別化に使う。
// 既存の選択色系統（#243042 / #4a6a8a）に馴染む明るさへ調整した値。
export const SCENE_ACCENT = "#5b87b8";

const ICON = (body: string): string =>
  `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
  `stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const SCENES_ICON = ICON('<rect x="3" y="4" width="14" height="14" rx="2"/><path d="M21 7v13H8"/>');
const DUP_ICON = ICON('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>');
const TRASH_ICON = ICON('<polyline points="4 7 20 7"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/>');
// #174: 出力シーン切替用モニターアイコン。
const MONITOR_ICON = ICON('<rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/>');

/** シーンパネルのサイドドック定義を返す。一覧/追加を host に構築する。 */
export function scenePanelDef(actions: ScenePanelActions): SidePanelDef {
  return {
    id: "scene",
    title: t("panel.scenes"),
    icon: SCENES_ICON,
    accent: SCENE_ACCENT, // #259: アセットパネルと一目で見分けるための識別色
    mount: (host) => mountScenePanel(host, actions),
  };
}

function mountScenePanel(host: HTMLElement, actions: ScenePanelActions): void {
  const listEl = document.createElement("div");
  listEl.style.cssText = "display:flex;flex-direction:column;gap:4px;overflow-y:auto;flex:1 1 auto;";
  host.appendChild(listEl);

  const addBtn = document.createElement("button");
  addBtn.textContent = t("scenes.add");
  addBtn.style.cssText = BTN_CSS + "text-align:center;flex:0 0 auto;";
  addBtn.addEventListener("click", () => actions.add());
  host.appendChild(addBtn);

  function render(): void {
    listEl.innerHTML = "";
    const activeId = actions.activeId();
    const scenes = actions.list();
    const ids = scenes.map((s) => s.id);
    const outId = actions.outputId();
    const effectiveOut = effectiveOutputSceneId(outId, activeId, ids);
    const following = isFollowingEdit(outId, ids);
    scenes.forEach((scene, i) => {
      listEl.appendChild(renderRow(scene, i, scene.id === activeId, scene.id === effectiveOut, following, scenes.length));
    });
  }

  function renderRow(scene: Scene, index: number, isActive: boolean, isOutput: boolean, following: boolean, count: number): HTMLElement {
    const row = document.createElement("div");
    // #259: 左 3px のアクセントボーダー（シーン=青）でアセット行と見分ける。
    row.style.cssText =
      "display:flex;align-items:center;gap:6px;padding:4px 6px;border:1px solid #333;border-radius:4px;cursor:pointer;" +
      `border-left:3px solid ${SCENE_ACCENT};` +
      `background:${isActive ? "#243042" : "#16161c"};`;

    // #259: 左端に番号バッジ（1,2,3…）。アクティブ行は accent 背景で反転して視認性を上げる。
    const num = document.createElement("span");
    num.textContent = String(index + 1);
    num.style.cssText =
      "flex:0 0 auto;min-width:14px;text-align:center;font:10px/1.5 system-ui;border-radius:3px;padding:0 3px;" +
      (isActive ? `background:${SCENE_ACCENT};color:#0e1116;font-weight:700;` : "background:#1f2733;color:#8fb0cf;");
    row.appendChild(num);

    const name = document.createElement("div");
    name.textContent = scene.name;
    name.style.cssText = "flex:1 1 auto;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" +
      (isActive ? "color:#cfe;font-weight:600;" : "");
    row.appendChild(name);

    // #174: 出力中のシーンにバッジを表示（追従中は「編集に追従」を明示）。
    if (isOutput) {
      const badge = document.createElement("span");
      badge.textContent = following ? t("scenes.badge.outputFollow") : t("scenes.badge.output");
      badge.title = following ? t("scenes.badge.followTitle") : t("scenes.badge.pinnedTitle");
      badge.style.cssText = "flex:0 0 auto;font:10px system-ui;color:#ff6b6b;white-space:nowrap;";
      row.appendChild(badge);
    }

    row.addEventListener("click", () => actions.switchTo(scene.id));

    name.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      const input = document.createElement("input");
      input.value = scene.name;
      input.style.cssText = "flex:1 1 auto;min-width:0;background:#111;color:#ddd;border:1px solid #4a5566;border-radius:3px;padding:2px 4px;";
      // #255: 編集開始。自動保存の onChange による再描画は endEdit まで保留される。
      hold.beginEdit();
      // #255: Enter 確定 / Escape キャンセル / blur 確定を一本化し、一度だけ実行する
      // （render で input が外れた際の blur による二重 rename / 二重 render を防ぐ）。
      let finished = false;
      const finish = (apply: boolean): void => {
        if (finished) return;
        finished = true;
        const v = input.value.trim();
        hold.endEdit(); // 編集フラグ解除。保留があればここで flush
        if (apply && v) actions.rename(scene.id, v); // rename の onChange で再描画される
        else render(); // キャンセル・空文字は表示を復元
      };
      input.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") { ev.preventDefault(); finish(true); }
        else if (ev.key === "Escape") { ev.preventDefault(); finish(false); }
      });
      input.addEventListener("blur", () => finish(true));
      input.addEventListener("click", (ev) => ev.stopPropagation());
      row.replaceChild(input, name);
      input.focus(); input.select();
    });

    // #174: 出力トグル。既に出力ピン先ならクリックで追従（null）に戻す。別シーンならピン留め。
    const out = document.createElement("button");
    out.innerHTML = MONITOR_ICON;
    const pinnedHere = isOutput && !following;
    out.title = pinnedHere ? t("scenes.output.unpin") : t("scenes.output.pin");
    out.style.cssText = BTN_CSS + "flex:0 0 auto;display:flex;align-items:center;justify-content:center;padding:3px 5px;" +
      (pinnedHere ? "color:#ff6b6b;border-color:#ff6b6b;" : "");
    out.addEventListener("click", (e) => {
      e.stopPropagation();
      actions.setOutput(pinnedHere ? null : scene.id);
    });
    row.appendChild(out);

    const dup = document.createElement("button");
    dup.innerHTML = DUP_ICON; dup.title = t("scenes.duplicate");
    dup.style.cssText = BTN_CSS + "flex:0 0 auto;display:flex;align-items:center;justify-content:center;padding:3px 5px;";
    dup.addEventListener("click", (e) => { e.stopPropagation(); actions.duplicate(scene.id); });
    row.appendChild(dup);

    const del = document.createElement("button");
    del.innerHTML = TRASH_ICON; del.title = count <= 1 ? t("scenes.deleteLast") : t("scenes.delete");
    del.disabled = count <= 1;
    del.style.cssText = BTN_CSS + "flex:0 0 auto;display:flex;align-items:center;justify-content:center;padding:3px 5px;" +
      (count <= 1 ? "opacity:0.4;cursor:not-allowed;" : "");
    del.addEventListener("click", (e) => { e.stopPropagation(); if (count > 1) actions.remove(scene.id); });
    row.appendChild(del);

    return row;
  }

  // #255: 名前編集中の再描画は保留し、編集終了時に flush する（自動保存で input を壊さない）。
  const hold = createRenderHold(render);
  actions.onChange(() => hold.request());
  render();
}
