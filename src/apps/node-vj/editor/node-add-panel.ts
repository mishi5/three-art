// #243: サイドドック「ノード追加」パネル。ツールバーのカテゴリボタン群（#103）を置き換え、
// registry から動的に生成したカテゴリ別の全ノード型一覧をクリックで追加する。
// 一覧データ生成と配置座標の決定は純関数（テスト対象）、DOM 構築は mount のみ。
// 右クリックメニューからの追加（NodeEditor.showAddMenu）はこのパネルと独立に残る。
// #258: パネルは右ドックへ移動。エッジドロップ（出力ポート起点の接続ドラッグを空白で離す）で
// 互換ノードのみに絞ったフィルタ状態で自動オープンし、選択でドロップ位置に追加＋自動接続する。
import { BAR_W, TOP, PANEL_W, type SidePanelDef } from "./side-dock";
import { groupNodesByCategory } from "./node-menu";
import { resolveNodeText, t } from "../i18n";
import { TITLE_H, CATEGORY_COLORS } from "./layout";
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

/** #256: 検索クエリ（ノード名・説明の部分一致・大小無視）にマッチするか。空クエリは全件通す。 */
export function matchesQuery(item: NodeAddItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  return item.type.toLowerCase().includes(q) || item.description.toLowerCase().includes(q);
}

/**
 * ノード定義からパネル表示用のセクション一覧を作る。カテゴリ分けと並び順は
 * 右クリックメニューと同じ groupNodesByCategory（#103）を共有する（#227 の再整理に自動追従）。
 * #254: description はカタログキーを保持するため resolveNodeText で現在言語に解決する
 * （カタログに無い文字列はそのまま通る）。
 * #258: allowedTypes（互換フィルタ）を指定すると該当型のみ残す。
 * #256: query（検索文字列）を指定するとノード名・説明の部分一致で絞る。互換フィルタと併用可。
 * どちらのフィルタでも空になったセクションは落とす。
 */
export function buildNodeAddSections(
  defs: ReadonlyArray<{ type: string; category?: string; description?: string }>,
  allowedTypes?: ReadonlySet<string> | null,
  query = "",
): NodeAddSection[] {
  const byType = new Map(defs.map((d) => [d.type, d]));
  return groupNodesByCategory(defs)
    .map((g) => ({
      category: g.category,
      items: g.types
        .filter((t) => !allowedTypes || allowedTypes.has(t))
        .map((t) => ({ type: t, description: resolveNodeText(byType.get(t)?.description ?? "") }))
        .filter((item) => matchesQuery(item, query)),
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

/**
 * #257: パネルチップからキャンバスへの D&D で運ぶ MIME。既存の
 * "application/x-node-vj-asset"（アセットパネル）・CLIP_MIME（クリップボードパネル）と同じ命名規則。
 */
export const NODE_TYPE_MIME = "application/x-node-vj-node-type";

/**
 * #257: パネルチップの D&D ドロップ位置（world）→ ノード配置座標。position はノード左上なので、
 * 入力ポート側（タイトル直下の行）が drop 付近に来るよう TITLE_H ぶん上げる。
 * wireDropPosition と異なり findFreeSpot は使わない（ユーザが狙って落とした座標にそのまま置く）。
 */
export function panelDropPosition(drop: { x: number; y: number }): { x: number; y: number } {
  return { x: drop.x, y: drop.y - TITLE_H };
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

/** チップの共通スタイル（名前のみの小ボタン・#256）。説明は title ツールチップに寄せる。 */
const CHIP_CSS =
  "display:inline-block;padding:3px 8px;border:1px solid #333;border-radius:4px;cursor:pointer;" +
  "background:#16161c;color:#ddd;font:12px system-ui;white-space:nowrap;" +
  "overflow:hidden;text-overflow:ellipsis;max-width:100%;";

/** DOM を構築し、フィルタ状態・検索クエリに応じて一覧を再描画する render を返す。 */
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

  // #256: 検索ボックス。ノード名・説明の部分一致で絞る（互換フィルタと併用可）。
  const search = document.createElement("input");
  search.dataset.role = "search";
  search.type = "search";
  search.placeholder = t("nodeAdd.search.placeholder");
  search.style.cssText =
    "flex:0 0 auto;background:#111;color:#ddd;border:1px solid #444;border-radius:4px;" +
    "padding:4px 8px;font:12px system-ui;box-sizing:border-box;width:100%;";
  search.addEventListener("input", () => render());
  host.appendChild(search);

  const body = document.createElement("div");
  body.style.cssText = "display:flex;flex-direction:column;gap:8px;overflow-y:auto;flex:1 1 auto;padding-top:2px;";
  host.appendChild(body);

  function render(): void {
    const filter = ctx.getFilter();
    filterBar.style.display = filter ? "flex" : "none";
    if (filter) badge.textContent = filterBadgeText(filter.portType);

    body.replaceChildren();
    const query = search.value;
    const sections = buildNodeAddSections(deps.defs(), filter ? filter.types : null, query);
    if (sections.length === 0) {
      // 空表示の理由を分けて出す（互換フィルタで全滅 / 検索で該当なし）。
      const empty = document.createElement("div");
      empty.dataset.role = query.trim() ? "search-empty" : "filter-empty";
      empty.textContent = query.trim() ? t("nodeAdd.search.empty") : t("nodeAdd.filter.empty");
      empty.style.cssText = "color:#889;padding:8px 2px;";
      if (query.trim() || filter) body.appendChild(empty);
    }
    for (const section of sections) {
      // #256: カテゴリごとのグループボックス（カテゴリ色の左ボーダーで境界を明確化）。
      const color = CATEGORY_COLORS[section.category] ?? "#333";
      const box = document.createElement("div");
      box.dataset.role = "group";
      box.dataset.category = section.category;
      box.style.cssText =
        `border-left:3px solid ${color};border-radius:4px;background:#141419;padding:5px 6px 7px;`;
      body.appendChild(box);

      const heading = document.createElement("div");
      heading.dataset.role = "section";
      heading.textContent = section.category;
      heading.style.cssText =
        "color:#9ab;font-size:11px;font-weight:600;padding:0 0 4px;text-transform:capitalize;";
      box.appendChild(heading);

      // #256: チップを複数列で敷き詰める（flex ラップ）。説明は title のみ＝スクロール量を圧縮。
      const chips = document.createElement("div");
      chips.style.cssText = "display:flex;flex-wrap:wrap;gap:4px;";
      box.appendChild(chips);

      for (const item of section.items) {
        const chip = document.createElement("button");
        chip.dataset.nodeType = item.type;
        chip.textContent = item.type;
        // ツールチップに名前＋説明の全文（チップ本体は名前のみ）。
        chip.title = item.description ? `${item.type} — ${item.description}` : item.type;
        chip.style.cssText = CHIP_CSS;
        chip.addEventListener("mouseenter", () => { chip.style.background = "#243042"; });
        chip.addEventListener("mouseleave", () => { chip.style.background = "#16161c"; });
        // クリックで追加。パネル内クリックなので #228 の自動クローズは走らず連続追加できる。
        // フィルタ中は選択（追加＋自動接続）扱い。
        chip.addEventListener("click", () => ctx.pick(item.type));
        // #257: ドラッグ開始点はチップ（パネル内）のため #228 の自動クローズ（pointerdown 起点）は
        // 発火しない。移動を伴わないプレスは dragstart が発火せず通常の click になるため、
        // クリック追加（上記）とドラッグ追加は共存する。
        chip.draggable = true;
        chip.addEventListener("dragstart", (e) => {
          e.dataTransfer?.setData(NODE_TYPE_MIME, item.type);
          if (e.dataTransfer) e.dataTransfer.effectAllowed = "copy";
        });
        chips.appendChild(chip);
      }
    }
  }

  render();
  return render;
}
