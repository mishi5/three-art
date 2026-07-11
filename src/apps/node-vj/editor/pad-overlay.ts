// #205: SamplePad のパッドを画面全体に拡大表示する DOM オーバーレイ。
// 大きな 4×4 パッドを並べ、click で発音（deps.play）・Shift+click で再割当（deps.assign）。
// 上部に Stop（全停止）と ✕（閉じる）。Esc でも閉じる。複数 SamplePad があっても対象ノードのみ表示する。
import { t } from "../i18n";

/** オーバーレイが対象ノードのパッド状態・操作を引くための依存。 */
export interface PadOverlayDeps {
  /** グリッド行数。 */
  rows: number;
  /** グリッド列数。 */
  cols: number;
  /** パッド index を発音する（user gesture 内で呼ばれる）。 */
  play: (nodeId: string, padIndex: number) => void;
  /** 発音中の音をすべて止める。 */
  stop: (nodeId: string) => void;
  /** 指定パッドで発音中の音だけ止める（個別停止）。 */
  stopVoice: (nodeId: string, padIndex: number) => void;
  /** パッド index へ音声ファイルを（再）割り当てる（ファイルダイアログを開く）。 */
  assign: (nodeId: string, padIndex: number) => void;
  /** パッド index の割当を解除する（空に戻す）。 */
  unassign: (nodeId: string, padIndex: number) => void;
  /** パッドの状態（割当済みか・短縮ラベル）を引く。
   *  #281: active（再生中の強調）/ armed（予約中の点滅）は ClipLauncher 用の任意フィールド。 */
  info: (nodeId: string, padIndex: number) =>
    { filled: boolean; label: string | null; active?: boolean; armed?: boolean } | undefined;
}

/** 既に開いているオーバーレイ（多重オープンを防ぐ）。 */
let currentOverlay: HTMLDivElement | null = null;
let currentTimer: number | null = null;

/**
 * #205: 対象 SamplePad のパッドを全画面オーバーレイで開く。既に開いていれば一旦閉じてから開き直す。
 */
export function openPadOverlay(nodeId: string, deps: PadOverlayDeps): void {
  closePadOverlay();
  const rows = Math.max(1, deps.rows);
  const cols = Math.max(1, deps.cols);
  const count = rows * cols;

  const root = document.createElement("div");
  root.style.cssText =
    "position:fixed;inset:0;z-index:500;background:rgba(8,8,12,0.92);" +
    "display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;" +
    "font:14px system-ui;color:#ddd;";

  // 上部バー（Stop / 閉じる / ヒント）。
  const bar = document.createElement("div");
  bar.style.cssText = "display:flex;gap:12px;align-items:center;";
  const stopBtn = document.createElement("button");
  stopBtn.type = "button";
  stopBtn.textContent = "■ Stop";
  stopBtn.style.cssText =
    "background:#3a2a2a;color:#e9a0a0;border:1px solid #5a3a3a;border-radius:6px;padding:8px 16px;cursor:pointer;font:14px system-ui;";
  stopBtn.addEventListener("click", () => deps.stop(nodeId));
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.textContent = t("pad.close");
  closeBtn.style.cssText =
    "background:#1c1c22;color:#ddd;border:1px solid #444;border-radius:6px;padding:8px 16px;cursor:pointer;font:14px system-ui;";
  closeBtn.addEventListener("click", () => closePadOverlay());
  const hint = document.createElement("span");
  hint.textContent = t("pad.hint");
  hint.style.cssText = "color:#888;";
  bar.append(stopBtn, closeBtn, hint);

  // パッドグリッド本体。
  const gridEl = document.createElement("div");
  const cell = "min(14vh, 14vw)";
  gridEl.style.cssText =
    `display:grid;grid-template-columns:repeat(${cols}, ${cell});grid-template-rows:repeat(${rows}, ${cell});gap:14px;`;

  const refresh: (() => void)[] = [];
  const refreshAll = (): void => {
    refresh.forEach((f) => f());
    setTimeout(() => refresh.forEach((f) => f()), 400); // 割当はダイアログ非同期なので遅延再同期
  };
  for (let i = 0; i < count; i++) {
    const btn = document.createElement("button");
    btn.type = "button"; // 既定 submit を避ける
    const sync = (): void => {
      const info = deps.info(nodeId, i);
      const filled = info?.filled ?? false;
      const label = filled ? (info?.label ?? null) : null;
      btn.textContent = label ?? String(i + 1);
      btn.title = filled ? t("pad.cell.filledTitle") : t("pad.cell.emptyTitle");
      // #281: active は明るい塗り＋枠で強調、armed は 250ms 周期で枠色を点滅（定期 refresh で再同期）。
      const active = info?.active ?? false;
      const armedBlink = (info?.armed ?? false) && Math.floor(performance.now() / 250) % 2 === 0;
      const tone = active
        ? "background:#3f7a58;color:#eafff3;border:2px solid #a5f2cd;"
        : filled
          ? "background:#2f5a44;color:#cfeede;border:2px solid #5cc99a;"
          : "background:#1e2228;color:#586068;border:2px solid #3a4048;";
      btn.style.cssText =
        "border-radius:10px;cursor:pointer;font:16px system-ui;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:6px;" +
        tone + (armedBlink ? "border-color:#ffd27a;" : "");
    };
    sync();
    refresh.push(sync);
    // 左クリックは発音のみ（空パッドは何もしない）。
    btn.addEventListener("click", () => {
      if (deps.info(nodeId, i)?.filled) deps.play(nodeId, i);
    });
    // 右クリックでパッド操作メニュー（割当/再割当/停止/解除）。
    btn.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      showPadCtxMenu(e.clientX, e.clientY, nodeId, i, deps, refreshAll);
    });
    gridEl.appendChild(btn);
  }

  root.append(bar, gridEl);
  // 背景（パッド以外）クリックで閉じる。
  root.addEventListener("click", (e) => { if (e.target === root) closePadOverlay(); });
  document.body.appendChild(root);
  currentOverlay = root;
  // #205: 割当/再割当はファイル選択が非同期で後から完了するため、表示中は定期的にボタン表示を再同期する。
  // #281: armed 点滅（250ms 周期）を目視できるよう 300ms → 125ms に短縮。
  currentTimer = window.setInterval(() => refresh.forEach((f) => f()), 125);
  window.addEventListener("keydown", onOverlayKey);
}

function onOverlayKey(e: KeyboardEvent): void {
  if (e.key === "Escape") { if (currentCtxMenu) closePadCtxMenu(); else closePadOverlay(); }
}

/** オーバーレイを閉じる（開いていなければ no-op）。 */
export function closePadOverlay(): void {
  closePadCtxMenu();
  if (currentTimer !== null) { window.clearInterval(currentTimer); currentTimer = null; }
  window.removeEventListener("keydown", onOverlayKey);
  if (currentOverlay) { currentOverlay.remove(); currentOverlay = null; }
}

// --- パッド右クリックメニュー（オーバーレイ上の DOM メニュー） ---
let currentCtxMenu: HTMLDivElement | null = null;

function onCtxOutside(e: PointerEvent): void {
  if (currentCtxMenu && !currentCtxMenu.contains(e.target as Node)) closePadCtxMenu();
}

function closePadCtxMenu(): void {
  window.removeEventListener("pointerdown", onCtxOutside, true);
  if (currentCtxMenu) { currentCtxMenu.remove(); currentCtxMenu = null; }
}

/** パッドの右クリックメニューを cursor 位置に出す（空=割当 / 音入り=再生・停止・再割当・解除）。 */
function showPadCtxMenu(
  x: number, y: number, nodeId: string, padIndex: number, deps: PadOverlayDeps, refreshAll: () => void,
): void {
  closePadCtxMenu();
  const menu = document.createElement("div");
  menu.style.cssText =
    `position:fixed;left:${x}px;top:${y}px;z-index:520;background:#16161c;border:1px solid #444;` +
    "border-radius:6px;padding:4px;font:13px system-ui;color:#ddd;box-shadow:0 4px 16px rgba(0,0,0,0.5);min-width:160px;";
  const item = (text: string, onClick: () => void): void => {
    const el = document.createElement("div");
    el.textContent = text;
    el.style.cssText = "padding:6px 10px;border-radius:4px;cursor:pointer;white-space:nowrap;";
    el.addEventListener("mouseenter", () => { el.style.background = "#2a2a36"; });
    el.addEventListener("mouseleave", () => { el.style.background = "transparent"; });
    el.addEventListener("click", () => { closePadCtxMenu(); onClick(); refreshAll(); });
    menu.appendChild(el);
  };
  if (deps.info(nodeId, padIndex)?.filled ?? false) {
    item(t("pad.menu.stopVoice"), () => deps.stopVoice(nodeId, padIndex));
    item(t("pad.menu.reassign"), () => deps.assign(nodeId, padIndex));
    item(t("pad.menu.unassign"), () => deps.unassign(nodeId, padIndex));
  } else {
    item(t("pad.menu.assign"), () => deps.assign(nodeId, padIndex));
  }
  document.body.appendChild(menu);
  const r = menu.getBoundingClientRect();
  if (r.right > window.innerWidth) menu.style.left = `${Math.max(4, window.innerWidth - r.width - 4)}px`;
  if (r.bottom > window.innerHeight) menu.style.top = `${Math.max(4, window.innerHeight - r.height - 4)}px`;
  currentCtxMenu = menu;
  setTimeout(() => window.addEventListener("pointerdown", onCtxOutside, true), 0);
}
