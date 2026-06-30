// #205: MidiPad のパッドを画面全体に拡大表示する DOM オーバーレイ。
// 大きな 4×4 パッドを並べ、click で発音（deps.play）・Shift+click で再割当（deps.assign）。
// 上部に Stop（全停止）と ✕（閉じる）。Esc でも閉じる。複数 MidiPad があっても対象ノードのみ表示する。

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
  /** パッド index へ音声ファイルを（再）割り当てる（ファイルダイアログを開く）。 */
  assign: (nodeId: string, padIndex: number) => void;
  /** パッドの状態（割当済みか・短縮ラベル）を引く。 */
  info: (nodeId: string, padIndex: number) => { filled: boolean; label: string | null } | undefined;
}

/** 既に開いているオーバーレイ（多重オープンを防ぐ）。 */
let currentOverlay: HTMLDivElement | null = null;

/**
 * #205: 対象 MidiPad のパッドを全画面オーバーレイで開く。既に開いていれば一旦閉じてから開き直す。
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
  stopBtn.textContent = "■ Stop";
  stopBtn.style.cssText =
    "background:#3a2a2a;color:#e9a0a0;border:1px solid #5a3a3a;border-radius:6px;padding:8px 16px;cursor:pointer;font:14px system-ui;";
  stopBtn.addEventListener("click", () => deps.stop(nodeId));
  const closeBtn = document.createElement("button");
  closeBtn.textContent = "✕ 閉じる (Esc)";
  closeBtn.style.cssText =
    "background:#1c1c22;color:#ddd;border:1px solid #444;border-radius:6px;padding:8px 16px;cursor:pointer;font:14px system-ui;";
  closeBtn.addEventListener("click", () => closePadOverlay());
  const hint = document.createElement("span");
  hint.textContent = "クリック=発音 / Shift+クリック=音声を再割り当て";
  hint.style.cssText = "color:#888;";
  bar.append(stopBtn, closeBtn, hint);

  // パッドグリッド本体。
  const gridEl = document.createElement("div");
  const cell = "min(14vh, 14vw)";
  gridEl.style.cssText =
    `display:grid;grid-template-columns:repeat(${cols}, ${cell});grid-template-rows:repeat(${rows}, ${cell});gap:14px;`;

  const refresh: (() => void)[] = [];
  for (let i = 0; i < count; i++) {
    const btn = document.createElement("button");
    const sync = (): void => {
      const info = deps.info(nodeId, i);
      const filled = info?.filled ?? false;
      const label = filled ? (info?.label ?? null) : null;
      btn.textContent = label ?? String(i + 1);
      btn.title = filled ? "クリックで発音 / Shift+クリックで再割り当て" : "クリックで音声を割り当て";
      btn.style.cssText =
        "border-radius:10px;cursor:pointer;font:16px system-ui;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:6px;" +
        (filled
          ? "background:#2f5a44;color:#cfeede;border:2px solid #5cc99a;"
          : "background:#1e2228;color:#586068;border:2px solid #3a4048;");
    };
    sync();
    refresh.push(sync);
    btn.addEventListener("click", (e) => {
      const filled = deps.info(nodeId, i)?.filled ?? false;
      if (filled && !e.shiftKey) deps.play(nodeId, i);
      else deps.assign(nodeId, i);
      // 割当はダイアログ非同期なので、戻った後に表示を更新できるよう少し遅らせて再同期。
      setTimeout(() => refresh.forEach((f) => f()), 400);
    });
    gridEl.appendChild(btn);
  }

  root.append(bar, gridEl);
  // 背景（パッド以外）クリックで閉じる。
  root.addEventListener("click", (e) => { if (e.target === root) closePadOverlay(); });
  document.body.appendChild(root);
  currentOverlay = root;
  window.addEventListener("keydown", onOverlayKey);
}

function onOverlayKey(e: KeyboardEvent): void {
  if (e.key === "Escape") closePadOverlay();
}

/** オーバーレイを閉じる（開いていなければ no-op）。 */
export function closePadOverlay(): void {
  window.removeEventListener("keydown", onOverlayKey);
  if (currentOverlay) { currentOverlay.remove(); currentOverlay = null; }
}
