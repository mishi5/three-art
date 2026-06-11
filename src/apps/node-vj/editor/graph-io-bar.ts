// グラフの保存/読込 UI（#65）。named プリセット（localStorage）と YAML 書出/読込。
import type { GraphDoc } from "../graph/graph-doc";
import { replaceGraph } from "../graph/graph-doc";
import type { NodeRegistry } from "../graph/node-type";
import { serializeGraph, deserializeGraph } from "../graph/serialize";
import { GraphStore } from "../graph/graph-store";

const BTN_CSS =
  "background:#1c1c22;color:#ddd;border:1px solid #444;border-radius:4px;padding:4px 8px;cursor:pointer;";

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

/** 右下に保存/読込バーを作る。グラフは replaceGraph でその場置換する。 */
export function buildGraphIoBar(
  graph: GraphDoc,
  registry: NodeRegistry,
  store: GraphStore,
): HTMLDivElement {
  const bar = document.createElement("div");
  // ノード追加ツールバー（上段）との重なりを避けて 2 段目に置く。
  bar.style.cssText =
    "position:fixed;right:12px;top:40px;display:flex;gap:6px;align-items:center;z-index:150;font:12px system-ui;";

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.placeholder = "preset 名";
  nameInput.style.cssText = "width:110px;background:#111;color:#ddd;border:1px solid #444;border-radius:4px;padding:4px 6px;";
  bar.appendChild(nameInput);

  const select = document.createElement("select");
  select.style.cssText = BTN_CSS;
  const syncList = (): void => {
    select.innerHTML = "";
    const names = store.list();
    const head = document.createElement("option");
    head.value = ""; head.textContent = names.length ? "(読込...)" : "(保存なし)";
    select.appendChild(head);
    for (const n of names) {
      const o = document.createElement("option");
      o.value = n; o.textContent = n;
      select.appendChild(o);
    }
  };
  syncList();

  const applyYaml = (text: string, sourceLabel: string): void => {
    try {
      const { graph: loaded, warnings } = deserializeGraph(text, registry);
      replaceGraph(graph, loaded);
      for (const w of warnings) console.warn(`[graph-io] ${w}`);
      toast(warnings.length ? `${sourceLabel}: 読込（警告 ${warnings.length} 件）` : `${sourceLabel}: 読込完了`);
    } catch (e) {
      console.warn("[graph-io] load failed:", e);
      toast(`${sourceLabel}: 読込失敗（${e instanceof Error ? e.message : "不明なエラー"}）`, true);
    }
  };

  const saveBtn = document.createElement("button");
  saveBtn.textContent = "保存";
  saveBtn.style.cssText = BTN_CSS;
  saveBtn.addEventListener("click", () => {
    try {
      const name = nameInput.value.trim() || "default";
      store.save(name, serializeGraph(graph));
      nameInput.value = name;
      syncList();
      select.value = name;
      toast(`保存しました: ${name}`);
    } catch (e) {
      toast(`保存失敗（${e instanceof Error ? e.message : "不明"}）`, true);
    }
  });
  bar.appendChild(saveBtn);

  select.addEventListener("change", () => {
    const name = select.value;
    if (!name) return;
    const text = store.load(name);
    if (text === null) { toast(`見つかりません: ${name}`, true); return; }
    nameInput.value = name;
    applyYaml(text, name);
  });
  bar.appendChild(select);

  const delBtn = document.createElement("button");
  delBtn.textContent = "削除";
  delBtn.style.cssText = BTN_CSS;
  delBtn.addEventListener("click", () => {
    const name = select.value || nameInput.value.trim();
    if (!name) { toast("削除する preset を選択してください", true); return; }
    store.remove(name);
    syncList();
    toast(`削除しました: ${name}`);
  });
  bar.appendChild(delBtn);

  const sep = document.createElement("span");
  sep.textContent = "|";
  sep.style.color = "#555";
  bar.appendChild(sep);

  const exportBtn = document.createElement("button");
  exportBtn.textContent = "YAML書出";
  exportBtn.style.cssText = BTN_CSS;
  exportBtn.addEventListener("click", () => {
    const blob = new Blob([serializeGraph(graph)], { type: "text/yaml" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${nameInput.value.trim() || "graph"}.yaml`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
  bar.appendChild(exportBtn);

  const importLabel = document.createElement("label");
  importLabel.textContent = "YAML読込";
  importLabel.style.cssText = BTN_CSS;
  const importInput = document.createElement("input");
  importInput.type = "file";
  importInput.accept = ".yaml,.yml,text/yaml";
  importInput.style.display = "none";
  importInput.addEventListener("change", () => {
    const file = importInput.files?.[0];
    if (!file) return;
    file.text().then((text) => applyYaml(text, file.name));
    importInput.value = "";
  });
  importLabel.appendChild(importInput);
  bar.appendChild(importLabel);

  document.body.appendChild(bar);
  return bar;
}
