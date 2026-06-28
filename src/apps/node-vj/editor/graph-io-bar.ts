// グラフの保存/読込 UI（#65）。named プリセット（localStorage）と YAML 書出/読込。
import type { GraphDoc } from "../graph/graph-doc";
import { replaceGraph } from "../graph/graph-doc";
import type { NodeRegistry } from "../graph/node-type";
import { serializeGraph, deserializeGraph } from "../graph/serialize";
import { GraphStore } from "../graph/graph-store";
import type { History } from "../graph/history";

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

/** #201 プロジェクト（全シーン状態）の保存/読込フック。任意。 */
export interface ProjectIoHooks {
  /** 現在の全シーン状態を YAML 文字列にする（保存ボタン用）。 */
  serialize: () => string;
  /** YAML を解釈し全シーンを差し替える。warnings を返す。失敗時は throw。 */
  apply: (text: string) => string[];
  /** ダウンロードファイル名（例: node-vj-project-YYYYMMDD-HHMMSS.yaml）。 */
  downloadName: () => string;
}

/** 右下に保存/読込バーを作る。グラフは replaceGraph でその場置換する。 */
export function buildGraphIoBar(
  graph: GraphDoc,
  registry: NodeRegistry,
  store: GraphStore,
  history: History,
  /** #154: グラフ読込完了後に呼ぶ（アセットの自動復元フック）。任意。 */
  onLoad?: () => void,
  /** #201: プロジェクト（全シーン）保存/読込。任意。 */
  project?: ProjectIoHooks,
): HTMLDivElement {
  const bar = document.createElement("div");
  // ノード追加ツールバー（上段）はノード増加で複数行に折り返すため、衝突を避けて
  // 右下に置く（本格的なメニュー整理は #103）。
  bar.style.cssText =
    "position:fixed;right:12px;bottom:8px;display:flex;gap:6px;align-items:center;z-index:150;font:12px system-ui;";

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
      // 読込はワークスペースの置き換えなので履歴をクリアする（#90）
      history.clear();
      for (const w of warnings) console.warn(`[graph-io] ${w}`);
      onLoad?.();
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

  // #201: プロジェクト（全シーン状態）の保存/読込。単一グラフ書出/読込とは別機能。
  if (project) {
    const sep2 = document.createElement("span");
    sep2.textContent = "|";
    sep2.style.color = "#555";
    bar.appendChild(sep2);

    const projSaveBtn = document.createElement("button");
    projSaveBtn.textContent = "Proj保存";
    projSaveBtn.title = "全シーンを 1 ファイル（.yaml）に保存";
    projSaveBtn.style.cssText = BTN_CSS;
    projSaveBtn.addEventListener("click", () => {
      try {
        const blob = new Blob([project.serialize()], { type: "text/yaml" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = project.downloadName();
        a.click();
        URL.revokeObjectURL(a.href);
        toast("プロジェクトを保存しました");
      } catch (e) {
        toast(`プロジェクト保存失敗（${e instanceof Error ? e.message : "不明"}）`, true);
      }
    });
    bar.appendChild(projSaveBtn);

    const projLoadLabel = document.createElement("label");
    projLoadLabel.textContent = "Proj開く";
    projLoadLabel.title = "プロジェクト（全シーン）を読み込み、現在の状態を置き換える";
    projLoadLabel.style.cssText = BTN_CSS;
    const projInput = document.createElement("input");
    projInput.type = "file";
    projInput.accept = ".yaml,.yml,text/yaml";
    projInput.style.display = "none";
    projInput.addEventListener("change", () => {
      const file = projInput.files?.[0];
      if (!file) return;
      file.text().then((text) => {
        try {
          const warnings = project.apply(text);
          for (const w of warnings) console.warn(`[project-io] ${w}`);
          toast(warnings.length ? `${file.name}: 読込（警告 ${warnings.length} 件）` : `${file.name}: 読込完了`);
        } catch (e) {
          console.warn("[project-io] load failed:", e);
          toast(`${file.name}: 読込失敗（${e instanceof Error ? e.message : "不明なエラー"}）`, true);
        }
      });
      projInput.value = "";
    });
    projLoadLabel.appendChild(projInput);
    bar.appendChild(projLoadLabel);
  }

  document.body.appendChild(bar);
  return bar;
}
