// #243: サイドドック「ノード追加」パネル。ツールバーのカテゴリボタン群（#103）を置き換え、
// registry から動的に生成したカテゴリ別の全ノード型一覧をクリックで追加する。
// 一覧データ生成と配置座標の決定は純関数（テスト対象）、DOM 構築は mount のみ。
// 右クリックメニューからの追加（NodeEditor.showAddMenu）はこのパネルと独立に残る。
import { BAR_W, TOP, PANEL_W, type SidePanelDef } from "./side-dock";
import { groupNodesByCategory } from "./node-menu";

const ICON = (body: string): string =>
  `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
  `stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
// ＋（ノード追加）アイコン。
const PLUS_ICON = ICON('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>');

/** 一覧の 1 項目（ノード型と説明）。 */
export interface NodeAddItem {
  type: string;
  /** ノードの説明（def.description）。無ければ空文字。 */
  description: string;
}

/** カテゴリごとのセクション。 */
export interface NodeAddSection {
  category: string;
  items: NodeAddItem[];
}

/**
 * ノード定義からパネル表示用のセクション一覧を作る。カテゴリ分けと並び順は
 * 右クリックメニューと同じ groupNodesByCategory（#103）を共有する（#227 の再整理に自動追従）。
 */
export function buildNodeAddSections(
  defs: ReadonlyArray<{ type: string; category?: string; description?: string }>,
): NodeAddSection[] {
  const byType = new Map(defs.map((d) => [d.type, d]));
  return groupNodesByCategory(defs).map((g) => ({
    category: g.category,
    items: g.types.map((t) => ({ type: t, description: byType.get(t)?.description ?? "" })),
  }));
}

/** スクリーン座標の可視矩形。 */
export interface ViewRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * パネルからの追加時に「見えている範囲」とみなすスクリーン矩形。
 * ドック（アクティビティバー + パネル）の右端〜画面右端、ツールバー下〜画面下端。
 * パネルを開いてクリックする操作なので、パネル幅は常に差し引く。
 */
export function nodeAddViewRect(innerW: number, innerH: number): ViewRect {
  return { left: BAR_W + PANEL_W, top: TOP, right: innerW, bottom: innerH };
}

/** 矩形の中心。 */
export function viewCenter(view: ViewRect): { x: number; y: number } {
  return { x: (view.left + view.right) / 2, y: (view.top + view.bottom) / 2 };
}

/**
 * desired（world 座標の希望位置）に既存ノードが近すぎる場合、右下へ step ずつずらして
 * 空きを探す。連続追加で同じ位置に重ならないようにするための簡易回避で、
 * maxTries を超えたら打ち切ってその位置を返す（無限ループしない）。
 */
export function findFreeSpot(
  desired: { x: number; y: number },
  occupied: ReadonlyArray<{ x: number; y: number }>,
  minDist = 40,
  step = 28,
  maxTries = 50,
): { x: number; y: number } {
  let p = { x: desired.x, y: desired.y };
  for (let i = 0; i < maxTries; i++) {
    const blocked = occupied.some((o) => Math.hypot(o.x - p.x, o.y - p.y) < minDist);
    if (!blocked) return p;
    p = { x: p.x + step, y: p.y + step };
  }
  return p;
}

/** ノード追加パネルが呼び出し側から受け取る依存。 */
export interface NodeAddPanelDeps {
  /** ノード定義一覧（registry.list()）。mount 時に一度読む。 */
  defs(): ReadonlyArray<{ type: string; category?: string; description?: string }>;
  /** 項目クリック。ビューポート中央への追加（NodeEditor.addNodeAtViewCenter）は呼び出し側が行う。 */
  onAdd(type: string): void;
}

/** ノード追加パネルのサイドドック定義。 */
export function nodeAddPanelDef(deps: NodeAddPanelDeps): SidePanelDef {
  return {
    id: "node-add",
    title: "ノード追加",
    icon: PLUS_ICON,
    mount: (host) => mountNodeAddPanel(host, deps),
  };
}

function mountNodeAddPanel(host: HTMLElement, deps: NodeAddPanelDeps): void {
  const body = document.createElement("div");
  body.style.cssText = "display:flex;flex-direction:column;gap:4px;overflow-y:auto;flex:1 1 auto;";
  host.appendChild(body);

  for (const section of buildNodeAddSections(deps.defs())) {
    // セクション見出し（controls-panel / settings-panel と同スタイル）。
    // カテゴリ名は registry の category id をそのまま表示（CSS capitalize・#244 の i18n 化に備え固定文言を増やさない）。
    const heading = document.createElement("div");
    heading.dataset.role = "section";
    heading.textContent = section.category;
    heading.style.cssText =
      "color:#9ab;font-size:11px;font-weight:600;padding:6px 2px 0;text-transform:capitalize;";
    body.appendChild(heading);

    for (const item of section.items) {
      const row = document.createElement("button");
      row.dataset.nodeType = item.type;
      row.title = item.description; // ツールチップに全文
      row.style.cssText =
        "display:flex;flex-direction:column;align-items:flex-start;gap:1px;padding:4px 8px;" +
        "border:1px solid #333;border-radius:4px;cursor:pointer;text-align:left;width:100%;box-sizing:border-box;" +
        "background:#16161c;color:#ddd;font:12px system-ui;";
      const name = document.createElement("div");
      name.textContent = item.type;
      name.style.cssText = "font-weight:600;";
      row.appendChild(name);
      if (item.description) {
        const desc = document.createElement("div");
        desc.textContent = item.description;
        desc.style.cssText =
          "color:#999;font-size:11px;line-height:1.4;max-width:100%;" +
          "white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
        row.appendChild(desc);
      }
      row.addEventListener("mouseenter", () => { row.style.background = "#243042"; });
      row.addEventListener("mouseleave", () => { row.style.background = "#16161c"; });
      // クリックでビューポート中央（空き）へ追加。パネル内クリックなので #228 の自動クローズは走らず、
      // 非ピン時でも連続追加できる。
      row.addEventListener("click", () => deps.onAdd(item.type));
      body.appendChild(row);
    }
  }
}
