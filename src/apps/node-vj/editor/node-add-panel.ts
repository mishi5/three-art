// #243: サイドドック「ノード追加」パネル。ツールバーのカテゴリボタン群（#103）を置き換え、
// registry から動的に生成したカテゴリ別の全ノード型一覧をクリックで追加する。
// 一覧データ生成と配置座標の決定は純関数（テスト対象）、DOM 構築は mount のみ。
// 右クリックメニューからの追加（NodeEditor.showAddMenu）はこのパネルと独立に残る。
// #258: パネルは右ドックへ移動。エッジドロップ（出力ポート起点の接続ドラッグを空白で離す）で
// 互換ノードのみに絞ったフィルタ状態で自動オープンし、選択でドロップ位置に追加＋自動接続する。
import { BAR_W, TOP, PANEL_W, type SidePanelDef } from "./side-dock";
import { groupNodesByCategory } from "./node-menu";
import { resolveNodeText, t } from "../i18n";
import { TITLE_H } from "./layout";
import type { PortType } from "../graph/port-types";

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
 * #254: description はカタログキーを保持するため resolveNodeText で現在言語に解決する
 * （カタログに無い文字列はそのまま通る）。
 * #258: allowedTypes（互換フィルタ）を指定すると該当型のみ残し、空になったセクションは落とす。
 */
export function buildNodeAddSections(
  defs: ReadonlyArray<{ type: string; category?: string; description?: string }>,
  allowedTypes?: ReadonlySet<string> | null,
): NodeAddSection[] {
  const byType = new Map(defs.map((d) => [d.type, d]));
  return groupNodesByCategory(defs)
    .map((g) => ({
      category: g.category,
      items: g.types
        .filter((t) => !allowedTypes || allowedTypes.has(t))
        .map((t) => ({ type: t, description: resolveNodeText(byType.get(t)?.description ?? "") })),
    }))
    .filter((s) => s.items.length > 0);
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
 * #258: パネルは右ドックにあるため、左バー右端 〜 右ドック（バー + パネル）の左端、
 * ツールバー下 〜 画面下端。パネルを開いてクリックする操作なので、右パネル幅は常に差し引く。
 */
export function nodeAddViewRect(innerW: number, innerH: number): ViewRect {
  return { left: BAR_W, top: TOP, right: innerW - BAR_W - PANEL_W, bottom: innerH };
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

/**
 * #258: エッジドロップ位置（world）→ 追加ノードの配置座標。position はノード左上なので、
 * 入力ポート側（タイトル直下の行）が drop 付近に来るよう TITLE_H ぶん上げ、
 * 既存ノードとの重なりは findFreeSpot で回避する。
 */
export function wireDropPosition(
  drop: { x: number; y: number },
  occupied: ReadonlyArray<{ x: number; y: number }>,
): { x: number; y: number } {
  return findFreeSpot({ x: drop.x, y: drop.y - TITLE_H }, occupied);
}

/** #258: フィルタ中バッジの表示文言（例: "texture に接続可能"）。 */
export function filterBadgeText(portType: PortType): string {
  return t("nodeAdd.filter.badge", { type: portType });
}

/** #258: 互換フィルタ。エッジドロップ時に setFilter で適用する。 */
export interface NodeAddFilter {
  /** ドラッグ元の出力ポート型（バッジ表示用）。 */
  portType: PortType;
  /** 表示を許可するノード型（compatibleNodeTypes で算出したもの）。 */
  types: ReadonlySet<string>;
  /** フィルタ中の項目クリック。ドロップ位置への追加＋自動接続は呼び出し側が行う。 */
  onPick(type: string): void;
}

/** ノード追加パネルが呼び出し側から受け取る依存。 */
export interface NodeAddPanelDeps {
  /** ノード定義一覧（registry.list()）。mount 時に一度読む。 */
  defs(): ReadonlyArray<{ type: string; category?: string; description?: string }>;
  /** 項目クリック。ビューポート中央への追加（NodeEditor.addNodeAtViewCenter）は呼び出し側が行う。 */
  onAdd(type: string): void;
}

/** #258: ノード追加パネルの外部操作ハンドル（フィルタの適用/解除）。 */
export interface NodeAddPanelHandle {
  def: SidePanelDef;
  /** 互換フィルタを適用して一覧を絞る（バッジ＋解除ボタンを表示）。 */
  setFilter(filter: NodeAddFilter): void;
  /** フィルタを解除して全ノード表示へ戻す（何も追加しない）。 */
  clearFilter(): void;
  /** 現在のフィルタ（未適用なら null）。 */
  getFilter(): NodeAddFilter | null;
}

/**
 * #258: フィルタ可能なノード追加パネルを作る。
 * フィルタ中は Esc / ドックペイン外の pointerdown / 解除ボタン / パネル非表示（onHide）で解除する
 * （エッジドロップの pointerup では発火しない＝開いた直後に消えることはない）。
 */
export function createNodeAddPanel(deps: NodeAddPanelDeps): NodeAddPanelHandle {
  let filter: NodeAddFilter | null = null;
  let hostEl: HTMLElement | null = null;
  let render: () => void = () => {};

  // --- フィルタ中のみ有効な一時リスナ（capture・#166/#228 の closeOnOutside と同パターン） ---
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "Escape") clearFilter();
  };
  const onPointerDown = (e: Event): void => {
    // ドックのペイン（ヘッダ・ピン含む）内は操作継続。外ならキャンセル扱いでフィルタ解除。
    const pane = hostEl?.closest('[data-role="dock-pane"]') ?? hostEl;
    const target = e.target as Node | null;
    if (pane && target && pane.contains(target)) return;
    clearFilter();
  };

  function setFilter(f: NodeAddFilter): void {
    if (filter === null) {
      window.addEventListener("keydown", onKeyDown, true);
      document.addEventListener("pointerdown", onPointerDown, true);
    }
    filter = f;
    render();
  }

  function clearFilter(): void {
    if (filter === null) return;
    filter = null;
    window.removeEventListener("keydown", onKeyDown, true);
    document.removeEventListener("pointerdown", onPointerDown, true);
    render();
  }

  const def: SidePanelDef = {
    id: "node-add",
    title: t("panel.nodeAdd"),
    icon: PLUS_ICON,
    mount: (host) => {
      hostEl = host;
      render = mountNodeAddPanel(host, deps, {
        getFilter: () => filter,
        // 項目クリック: フィルタ中は onPick（追加＋自動接続）、通常は onAdd（ビュー中央へ追加）。
        pick: (type) => {
          const f = filter;
          clearFilter();
          if (f) f.onPick(type);
          else deps.onAdd(type);
        },
        clear: () => clearFilter(),
      });
    },
    // パネルが閉じられた/切り替えられたらフィルタも解除（何も追加しないキャンセル）。
    onHide: () => clearFilter(),
  };

  return { def, setFilter, clearFilter, getFilter: () => filter };
}

/** ノード追加パネルのサイドドック定義（従来 API・フィルタ操作が不要な呼び出し用）。 */
export function nodeAddPanelDef(deps: NodeAddPanelDeps): SidePanelDef {
  return createNodeAddPanel(deps).def;
}

/** mount 内部で使う描画コンテキスト。 */
interface RenderCtx {
  getFilter(): NodeAddFilter | null;
  pick(type: string): void;
  clear(): void;
}

/** DOM を構築し、フィルタ状態に応じて一覧を再描画する render を返す。 */
function mountNodeAddPanel(host: HTMLElement, deps: NodeAddPanelDeps, ctx: RenderCtx): () => void {
  // #258: フィルタ中バッジ行（バッジ＋解除ボタン）。通常時は非表示で高さを取らない。
  const filterBar = document.createElement("div");
  filterBar.style.cssText = "display:none;align-items:center;gap:6px;flex:0 0 auto;";
  const badge = document.createElement("span");
  badge.dataset.role = "filter-badge";
  badge.style.cssText =
    "background:#243042;color:#cfe;border:1px solid #4a6a8a;border-radius:10px;" +
    "padding:2px 8px;font-size:11px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
  const clearBtn = document.createElement("button");
  clearBtn.dataset.role = "filter-clear";
  clearBtn.textContent = t("nodeAdd.filter.clear");
  clearBtn.title = t("nodeAdd.filter.clearTitle");
  clearBtn.style.cssText =
    "margin-left:auto;background:#1c1c22;color:#ddd;border:1px solid #444;border-radius:4px;" +
    "cursor:pointer;padding:2px 8px;font:11px system-ui;flex:0 0 auto;";
  clearBtn.addEventListener("click", () => ctx.clear());
  filterBar.append(badge, clearBtn);
  host.appendChild(filterBar);

  const body = document.createElement("div");
  body.style.cssText = "display:flex;flex-direction:column;gap:4px;overflow-y:auto;flex:1 1 auto;";
  host.appendChild(body);

  function render(): void {
    const filter = ctx.getFilter();
    filterBar.style.display = filter ? "flex" : "none";
    if (filter) badge.textContent = filterBadgeText(filter.portType);

    body.replaceChildren();
    const sections = buildNodeAddSections(deps.defs(), filter ? filter.types : null);
    if (filter && sections.length === 0) {
      // 互換ノードが 1 つも無い（現状 texture→texture のみ等では起こりうる）。
      const empty = document.createElement("div");
      empty.dataset.role = "filter-empty";
      empty.textContent = t("nodeAdd.filter.empty");
      empty.style.cssText = "color:#889;padding:8px 2px;";
      body.appendChild(empty);
    }
    for (const section of sections) {
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
        // クリックで追加。パネル内クリックなので #228 の自動クローズは走らず、
        // 非ピン時でも連続追加できる。フィルタ中は選択（追加＋自動接続）扱い。
        row.addEventListener("click", () => ctx.pick(item.type));
        body.appendChild(row);
      }
    }
  }

  render();
  return render;
}
