// #154: アセットライブラリの左サイドペイン UI（DOM・手動 / Playwright 確認）。
// ロジック層（AssetLibrary 等）の配線のみ。純関数 panelDisplay / formatBytes はテスト対象。
import type { AssetLibrary } from "./asset-library";
import type { AssetMeta } from "./meta-store";
import type { AssetKind } from "./asset-kind";

/** 開閉状態 → ペイン本体の display 値（純関数）。 */
export function panelDisplay(open: boolean): "flex" | "none" {
  return open ? "flex" : "none";
}

/** バイト数を人が読みやすい単位へ整形する（純関数）。 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(1)} ${units[i]}`;
}

const KIND_ICON: Record<AssetKind, string> = { image: "🖼", video: "🎬", audio: "🎵" };

const PANEL_BG = "rgba(20,20,26,0.96)";
const BTN_CSS =
  "background:#1c1c22;color:#ddd;border:1px solid #444;border-radius:4px;padding:4px 8px;cursor:pointer;font:12px system-ui;";
// ツールバー（top:8・折返し）の下に置き、上部メニューを隠さない。
const PANE_TOP = 44;

function toast(message: string, isError = false): void {
  const div = document.createElement("div");
  div.textContent = message;
  div.style.cssText =
    "position:fixed;left:50%;bottom:48px;transform:translateX(-50%);z-index:300;" +
    "padding:8px 14px;border-radius:4px;font:12px system-ui;color:#fff;" +
    `background:${isError ? "rgba(140,40,40,0.92)" : "rgba(30,90,60,0.92)"};`;
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 2600);
}

/**
 * アセットの左サイドペインを構築して body へ追加する。戻り値はペイン本体のルート要素。
 * 画面左に固定（ツールバーの下）し、ヘッダの « トグルで折りたたみ、折畳時は左端の » タブで再展開する。
 * 初期は表示・開閉状態はメモリ保持のみ（永続化しない）。
 */
export function buildAssetPanel(library: AssetLibrary): HTMLElement {
  let open = true;
  // 一覧描画で作った ObjectURL を再描画時に解放するため保持する。
  let objectUrls: string[] = [];

  // --- 折畳時に左端へ出す再展開タブ（»）---
  const rail = document.createElement("button");
  rail.textContent = "📦";
  rail.title = "アセットパネルを開く";
  rail.style.cssText =
    BTN_CSS + `position:fixed;left:0;top:${PANE_TOP}px;z-index:156;border-radius:0 6px 6px 0;` +
    "display:none;padding:8px 6px;";
  document.body.appendChild(rail);

  // --- ペイン本体（左ドック・全高）---
  const pane = document.createElement("div");
  pane.style.cssText =
    `position:fixed;left:0;top:${PANE_TOP}px;bottom:48px;width:240px;` +
    `display:${panelDisplay(open)};flex-direction:column;gap:6px;z-index:155;` +
    `background:${PANEL_BG};border-right:1px solid #444;border-top:1px solid #444;` +
    `border-radius:0 6px 6px 0;padding:8px;box-sizing:border-box;` +
    `font:12px system-ui;color:#ddd;box-shadow:2px 0 16px rgba(0,0,0,0.4);`;

  // ヘッダ（見出し + 折りたたみ «）
  const header = document.createElement("div");
  header.style.cssText = "display:flex;align-items:center;justify-content:space-between;flex:0 0 auto;";
  const title = document.createElement("span");
  title.textContent = "アセット";
  title.style.cssText = "font-weight:600;";
  const collapseBtn = document.createElement("button");
  collapseBtn.textContent = "«";
  collapseBtn.title = "パネルを閉じる";
  collapseBtn.style.cssText = BTN_CSS + "padding:0 8px;line-height:20px;";
  header.appendChild(title);
  header.appendChild(collapseBtn);
  pane.appendChild(header);

  // 一覧コンテナ（スクロール）
  const listEl = document.createElement("div");
  listEl.style.cssText = "display:flex;flex-direction:column;gap:4px;overflow-y:auto;flex:1 1 auto;";
  pane.appendChild(listEl);

  // 追加ボタン + 使用量表示
  const addLabel = document.createElement("label");
  addLabel.textContent = "＋ ファイル追加";
  addLabel.style.cssText = BTN_CSS + "text-align:center;flex:0 0 auto;";
  const addInput = document.createElement("input");
  addInput.type = "file";
  addInput.multiple = true;
  addInput.accept = "image/*,video/*,audio/*";
  addInput.style.display = "none";
  addLabel.appendChild(addInput);
  pane.appendChild(addLabel);

  const usageEl = document.createElement("div");
  usageEl.style.cssText = "color:#999;font-size:11px;flex:0 0 auto;";
  pane.appendChild(usageEl);

  document.body.appendChild(pane);

  // --- 開閉 ---
  function setOpen(next: boolean): void {
    open = next;
    pane.style.display = panelDisplay(open);
    rail.style.display = open ? "none" : "block";
  }
  collapseBtn.addEventListener("click", () => setOpen(false));
  rail.addEventListener("click", () => setOpen(true));

  // --- 使用量 ---
  async function refreshUsage(): Promise<void> {
    try {
      const est = await navigator.storage?.estimate?.();
      if (est && typeof est.usage === "number") {
        const quota = typeof est.quota === "number" && est.quota > 0 ? ` / ${formatBytes(est.quota)}` : "";
        usageEl.textContent = `使用量: ${formatBytes(est.usage)}${quota}`;
      } else {
        usageEl.textContent = "";
      }
    } catch {
      usageEl.textContent = "";
    }
  }

  // --- 一覧描画 ---
  async function render(): Promise<void> {
    for (const u of objectUrls) URL.revokeObjectURL(u);
    objectUrls = [];
    listEl.innerHTML = "";
    const items = await library.list();
    if (items.length === 0) {
      const empty = document.createElement("div");
      empty.textContent = "（アセットなし）ファイルを D&D / 追加";
      empty.style.cssText = "color:#777;padding:6px 2px;";
      listEl.appendChild(empty);
    }
    for (const meta of items) {
      listEl.appendChild(renderRow(meta));
    }
    void refreshUsage();
  }

  function renderRow(meta: AssetMeta): HTMLElement {
    const row = document.createElement("div");
    row.draggable = true;
    row.title = meta.fileName;
    row.style.cssText =
      "display:flex;align-items:center;gap:6px;padding:4px;border:1px solid #333;" +
      "border-radius:4px;background:#16161c;cursor:grab;";

    // サムネ or アイコン
    const thumb = document.createElement("div");
    thumb.style.cssText =
      "width:48px;height:36px;flex:0 0 auto;display:flex;align-items:center;justify-content:center;" +
      "background:#000;border-radius:3px;overflow:hidden;font-size:18px;";
    if (meta.thumbnail) {
      const url = URL.createObjectURL(meta.thumbnail);
      objectUrls.push(url);
      const img = document.createElement("img");
      img.src = url;
      img.style.cssText = "max-width:100%;max-height:100%;display:block;";
      thumb.appendChild(img);
    } else {
      thumb.textContent = KIND_ICON[meta.kind];
    }
    row.appendChild(thumb);

    // 名前 + サイズ
    const info = document.createElement("div");
    info.style.cssText = "flex:1 1 auto;min-width:0;";
    const name = document.createElement("div");
    name.textContent = meta.fileName;
    name.style.cssText = "white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
    const size = document.createElement("div");
    size.textContent = formatBytes(meta.size);
    size.style.cssText = "color:#999;font-size:11px;";
    info.appendChild(name);
    info.appendChild(size);
    row.appendChild(info);

    // 削除
    const del = document.createElement("button");
    del.textContent = "🗑";
    del.style.cssText = BTN_CSS + "flex:0 0 auto;padding:2px 6px;";
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      void library.remove(meta.id);
    });
    row.appendChild(del);

    // D&D: canvas / ノードへ割り当てるための id を載せる
    row.addEventListener("dragstart", (e) => {
      e.dataTransfer?.setData("application/x-node-vj-asset", meta.id);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = "copy";
    });

    return row;
  }

  // --- ファイル追加（複数）---
  async function addFiles(files: FileList | File[]): Promise<void> {
    for (const file of Array.from(files)) {
      try {
        const m = await library.add(file);
        if (!m) toast(`未対応のファイル: ${file.name}`, true);
      } catch (e) {
        const name = e instanceof Error ? e.name : "";
        if (name === "QuotaExceededError") toast("ストレージ容量を超えました。不要なアセットを削除してください。", true);
        else toast(`追加に失敗: ${file.name}`, true);
        console.warn("[asset-panel] add failed:", e);
      }
    }
  }
  addInput.addEventListener("change", () => {
    if (addInput.files) void addFiles(addInput.files);
    addInput.value = "";
  });

  // OS からのファイル D&D（ペイン上）
  pane.addEventListener("dragover", (e) => {
    if (e.dataTransfer?.types.includes("Files")) { e.preventDefault(); }
  });
  pane.addEventListener("drop", (e) => {
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault();
    void addFiles(e.dataTransfer.files);
  });

  // 変更購読 + 初期描画
  library.onChange(() => { void render(); });
  void render();

  return pane;
}
