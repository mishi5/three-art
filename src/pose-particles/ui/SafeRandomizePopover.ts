/**
 * Safe Randomize (Issue #46) の除外 path 設定ポップオーバー。
 *
 * `QuickActionsBar` の `⚙` ボタンから `toggle(anchor)` で開閉する。
 * top-level prefix (camera / blur / color / ...) でグループ化し、各 path
 * に checkbox を 1 つ並べる。グループ header の checkbox は all-on /
 * all-off の一括切替。
 *
 * 配置: anchor の真下に position:fixed で出す (画面端では右端を調整)。
 * 閉じ条件: ポップオーバー外 mousedown / Esc。anchor 自体のクリックは
 * 開閉責務を `QuickActionsBar` 側 (toggle) に渡すため hide しない。
 */
import { RANDOMIZE_DESCRIPTORS } from "./randomize";

export interface SafeRandomizePopoverCallbacks {
  /** チェック状態が変わるたびに最新の除外集合を伴って呼ばれる。 */
  onChange: (excluded: ReadonlySet<string>) => void;
}

const PANEL_STYLE = `
  position: fixed;
  z-index: 60;
  background: rgba(20,20,20,0.95);
  color: #fff;
  border: 1px solid rgba(255,255,255,0.2);
  border-radius: 6px;
  padding: 10px 12px;
  font-family: system-ui, sans-serif;
  font-size: 12px;
  max-height: 70vh;
  overflow-y: auto;
  min-width: 280px;
  max-width: 360px;
  box-shadow: 0 4px 24px rgba(0,0,0,0.5);
`;

const GROUP_STYLE = `
  margin-bottom: 8px;
  padding-bottom: 6px;
  border-bottom: 1px solid rgba(255,255,255,0.08);
`;

const GROUP_HEADER_STYLE = `
  display: flex; align-items: center; gap: 6px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  font-size: 11px;
  color: #fff;
  margin-bottom: 4px;
  cursor: pointer;
  user-select: none;
`;

const ROW_STYLE = `
  display: flex; align-items: center; gap: 6px;
  padding: 2px 0 2px 18px;
  cursor: pointer;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  color: #ddd;
`;

interface GroupSpec {
  readonly prefix: string;
  readonly paths: ReadonlyArray<string>;
}

function buildGroups(): ReadonlyArray<GroupSpec> {
  const byPrefix = new Map<string, string[]>();
  for (const d of RANDOMIZE_DESCRIPTORS) {
    const dot = d.spec.path.indexOf(".");
    const prefix = dot < 0 ? d.spec.path : d.spec.path.slice(0, dot);
    let bucket = byPrefix.get(prefix);
    if (!bucket) {
      bucket = [];
      byPrefix.set(prefix, bucket);
    }
    bucket.push(d.spec.path);
  }
  return [...byPrefix.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([prefix, paths]) => ({ prefix, paths: paths.slice().sort() }));
}

export class SafeRandomizePopover {
  private excluded: Set<string>;
  private readonly callbacks: SafeRandomizePopoverCallbacks;
  private readonly groups: ReadonlyArray<GroupSpec>;
  private root: HTMLDivElement | null = null;
  private rowCheckboxes = new Map<string, HTMLInputElement>();
  private groupCheckboxes = new Map<string, HTMLInputElement>();
  private outsideHandler: ((e: MouseEvent) => void) | null = null;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private currentAnchor: HTMLElement | null = null;

  constructor(initial: ReadonlySet<string>, callbacks: SafeRandomizePopoverCallbacks) {
    this.excluded = new Set(initial);
    this.callbacks = callbacks;
    this.groups = buildGroups();
  }

  isOpen(): boolean {
    return this.root !== null;
  }

  show(anchor: HTMLElement): void {
    if (this.root) return;
    this.currentAnchor = anchor;
    this.root = this.build();
    this.positionTo(anchor);
    document.body.appendChild(this.root);
    this.attachGlobalListeners();
  }

  hide(): void {
    this.detachGlobalListeners();
    if (this.root && this.root.parentElement) {
      this.root.parentElement.removeChild(this.root);
    }
    this.root = null;
    this.rowCheckboxes.clear();
    this.groupCheckboxes.clear();
    this.currentAnchor = null;
  }

  toggle(anchor: HTMLElement): void {
    if (this.isOpen()) this.hide();
    else this.show(anchor);
  }

  dispose(): void {
    this.hide();
  }

  private build(): HTMLDivElement {
    const root = document.createElement("div");
    root.setAttribute("data-role", "safe-rand-popover");
    root.style.cssText = PANEL_STYLE;

    const title = document.createElement("div");
    title.textContent = "Safe Randomize: 除外する path";
    title.style.cssText = `
      font-weight: 600;
      margin-bottom: 8px;
      letter-spacing: 0.02em;
    `;
    root.appendChild(title);

    const hint = document.createElement("div");
    hint.textContent = "チェックを付けた path は safe-rand 実行時に変更されません。";
    hint.style.cssText = "font-size: 11px; opacity: 0.6; margin-bottom: 10px; line-height: 1.4;";
    root.appendChild(hint);

    for (const g of this.groups) {
      root.appendChild(this.buildGroup(g));
    }
    return root;
  }

  private buildGroup(group: GroupSpec): HTMLDivElement {
    const wrap = document.createElement("div");
    wrap.style.cssText = GROUP_STYLE;

    const header = document.createElement("label");
    header.style.cssText = GROUP_HEADER_STYLE;
    const headerCb = document.createElement("input");
    headerCb.type = "checkbox";
    headerCb.setAttribute("data-group", group.prefix);
    headerCb.addEventListener("change", () => {
      const on = headerCb.checked;
      for (const p of group.paths) {
        if (on) this.excluded.add(p);
        else this.excluded.delete(p);
        const cb = this.rowCheckboxes.get(p);
        if (cb) cb.checked = on;
      }
      this.refreshGroupState(group);
      this.callbacks.onChange(new Set(this.excluded));
    });
    header.appendChild(headerCb);
    const headerText = document.createElement("span");
    headerText.textContent = group.prefix;
    header.appendChild(headerText);
    wrap.appendChild(header);
    this.groupCheckboxes.set(group.prefix, headerCb);

    for (const p of group.paths) {
      wrap.appendChild(this.buildRow(p, group));
    }
    this.refreshGroupState(group);
    return wrap;
  }

  private buildRow(path: string, group: GroupSpec): HTMLLabelElement {
    const row = document.createElement("label");
    row.style.cssText = ROW_STYLE;
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.setAttribute("data-path", path);
    cb.checked = this.excluded.has(path);
    cb.addEventListener("change", () => {
      if (cb.checked) this.excluded.add(path);
      else this.excluded.delete(path);
      this.refreshGroupState(group);
      this.callbacks.onChange(new Set(this.excluded));
    });
    row.appendChild(cb);
    const text = document.createElement("span");
    text.textContent = path.slice(path.indexOf(".") + 1);
    text.title = path;
    row.appendChild(text);
    this.rowCheckboxes.set(path, cb);
    return row;
  }

  private refreshGroupState(group: GroupSpec): void {
    const header = this.groupCheckboxes.get(group.prefix);
    if (!header) return;
    let on = 0;
    for (const p of group.paths) if (this.excluded.has(p)) on++;
    if (on === 0) {
      header.checked = false;
      header.indeterminate = false;
    } else if (on === group.paths.length) {
      header.checked = true;
      header.indeterminate = false;
    } else {
      header.checked = false;
      header.indeterminate = true;
    }
  }

  private positionTo(anchor: HTMLElement): void {
    if (!this.root) return;
    const rect = anchor.getBoundingClientRect();
    // anchor の真下 4px、画面右端から 8px 以上空ける
    const top = rect.bottom + 4;
    this.root.style.top = `${top}px`;
    // 一旦 left を仮置きしてサイズ確定後にクランプ
    this.root.style.left = `${rect.left}px`;
    requestAnimationFrame(() => {
      if (!this.root) return;
      const pr = this.root.getBoundingClientRect();
      const maxLeft = window.innerWidth - pr.width - 8;
      const minLeft = 8;
      const clamped = Math.max(minLeft, Math.min(maxLeft, rect.left));
      this.root.style.left = `${clamped}px`;
    });
  }

  private attachGlobalListeners(): void {
    this.outsideHandler = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (this.root && this.root.contains(target)) return;
      if (this.currentAnchor && this.currentAnchor.contains(target)) return;
      this.hide();
    };
    this.keyHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") this.hide();
    };
    document.addEventListener("mousedown", this.outsideHandler, true);
    document.addEventListener("keydown", this.keyHandler, true);
  }

  private detachGlobalListeners(): void {
    if (this.outsideHandler) {
      document.removeEventListener("mousedown", this.outsideHandler, true);
      this.outsideHandler = null;
    }
    if (this.keyHandler) {
      document.removeEventListener("keydown", this.keyHandler, true);
      this.keyHandler = null;
    }
  }
}
