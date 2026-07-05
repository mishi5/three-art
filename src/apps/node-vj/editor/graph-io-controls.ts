// グラフの保存/読込 UI（#65）。named プリセット（localStorage）と YAML 書出/読込。
// #230: 右下の固定バーからサイドドック「コントロール」パネルへ移設（縦積みレイアウト）。
// ハンドラ/ロジック（applyYaml・一覧再構築・toast・ダウンロード）は従来のまま。
import type { GraphDoc } from "../graph/graph-doc";
import { replaceGraph } from "../graph/graph-doc";
import type { NodeRegistry } from "../graph/node-type";
import { serializeGraph, deserializeGraph } from "../graph/serialize";
import { GraphStore } from "../graph/graph-store";
import type { History } from "../graph/history";
import { t } from "../i18n";

// パネル内の行に等幅で並べるボタン/ラベル（label も button 見た目にする）。
const BTN_CSS =
  "background:#1c1c22;color:#ddd;border:1px solid #444;border-radius:4px;padding:4px 8px;cursor:pointer;" +
  "flex:1 1 0;text-align:center;box-sizing:border-box;font:12px system-ui;";
const FIELD_CSS =
  "background:#111;color:#ddd;border:1px solid #444;border-radius:4px;padding:4px 6px;" +
  "width:100%;box-sizing:border-box;font:12px system-ui;";

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

/** ボタンを等幅で横に並べる 1 行。 */
function row(...items: HTMLElement[]): HTMLDivElement {
  const div = document.createElement("div");
  div.style.cssText = "display:flex;gap:6px;";
  div.append(...items);
  return div;
}

/** #201 プロジェクト（全シーン状態）の保存/読込フック。 */
export interface ProjectIoHooks {
  /** 現在の全シーン状態を YAML 文字列にする（保存ボタン用）。 */
  serialize: () => string;
  /** YAML を解釈し全シーンを差し替える。warnings を返す。失敗時は throw。 */
  apply: (text: string) => string[];
  /** ダウンロードファイル名（例: node-vj-project-YYYYMMDD-HHMMSS.yaml）。 */
  downloadName: () => string;
}

/**
 * #230: シーン（グラフ preset）の保存/読込コントロールを host（コントロールパネルの
 * セクション）へ構築する。グラフは replaceGraph でその場置換する。
 */
export function mountGraphPresetControls(
  graph: GraphDoc,
  registry: NodeRegistry,
  store: GraphStore,
  history: History,
  host: HTMLElement,
  /** #154: グラフ読込完了後に呼ぶ（アセットの自動復元フック）。任意。 */
  onLoad?: () => void,
): void {
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.placeholder = t("graphIo.presetName");
  nameInput.style.cssText = FIELD_CSS;

  const select = document.createElement("select");
  select.style.cssText = FIELD_CSS + "cursor:pointer;";
  const syncList = (): void => {
    select.innerHTML = "";
    const names = store.list();
    const head = document.createElement("option");
    head.value = ""; head.textContent = names.length ? t("graphIo.selectLoad") : t("graphIo.selectNone");
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
      toast(warnings.length
        ? t("graphIo.toast.loadedWarn", { source: sourceLabel, n: warnings.length })
        : t("graphIo.toast.loaded", { source: sourceLabel }));
    } catch (e) {
      console.warn("[graph-io] load failed:", e);
      toast(t("graphIo.toast.loadFailed", {
        source: sourceLabel,
        error: e instanceof Error ? e.message : t("error.unknown"),
      }), true);
    }
  };

  const saveBtn = document.createElement("button");
  saveBtn.textContent = t("graphIo.save");
  saveBtn.style.cssText = BTN_CSS;
  saveBtn.addEventListener("click", () => {
    try {
      const name = nameInput.value.trim() || "default";
      store.save(name, serializeGraph(graph));
      nameInput.value = name;
      syncList();
      select.value = name;
      toast(t("graphIo.toast.saved", { name }));
    } catch (e) {
      toast(t("graphIo.toast.saveFailed", { error: e instanceof Error ? e.message : t("error.unknownShort") }), true);
    }
  });

  select.addEventListener("change", () => {
    const name = select.value;
    if (!name) return;
    const text = store.load(name);
    if (text === null) { toast(t("graphIo.toast.notFound", { name }), true); return; }
    nameInput.value = name;
    applyYaml(text, name);
  });

  const delBtn = document.createElement("button");
  delBtn.textContent = t("graphIo.delete");
  delBtn.style.cssText = BTN_CSS;
  delBtn.addEventListener("click", () => {
    const name = select.value || nameInput.value.trim();
    if (!name) { toast(t("graphIo.toast.selectDelete"), true); return; }
    store.remove(name);
    syncList();
    toast(t("graphIo.toast.deleted", { name }));
  });

  const exportBtn = document.createElement("button");
  exportBtn.textContent = t("graphIo.exportYaml");
  exportBtn.style.cssText = BTN_CSS;
  exportBtn.addEventListener("click", () => {
    const blob = new Blob([serializeGraph(graph)], { type: "text/yaml" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${nameInput.value.trim() || "graph"}.yaml`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  const importLabel = document.createElement("label");
  importLabel.textContent = t("graphIo.importYaml");
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

  host.append(nameInput, row(saveBtn, delBtn), select, row(exportBtn, importLabel));
}

/**
 * #201/#230: プロジェクト（全シーン状態）の保存/読込コントロールを host へ構築する。
 * 単一グラフ書出/読込（mountGraphPresetControls）とは別機能。
 */
export function mountProjectControls(project: ProjectIoHooks, host: HTMLElement): void {
  const projSaveBtn = document.createElement("button");
  projSaveBtn.textContent = t("project.save");
  projSaveBtn.title = t("project.saveTitle");
  projSaveBtn.style.cssText = BTN_CSS;
  projSaveBtn.addEventListener("click", () => {
    try {
      const blob = new Blob([project.serialize()], { type: "text/yaml" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = project.downloadName();
      a.click();
      URL.revokeObjectURL(a.href);
      toast(t("project.toast.saved"));
    } catch (e) {
      toast(t("project.toast.saveFailed", { error: e instanceof Error ? e.message : t("error.unknownShort") }), true);
    }
  });

  const projLoadLabel = document.createElement("label");
  projLoadLabel.textContent = t("project.open");
  projLoadLabel.title = t("project.openTitle");
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
        toast(
          warnings.length
            ? t("project.toast.loadedWarn", { source: file.name, n: warnings.length })
            : t("graphIo.toast.loaded", { source: file.name }),
          warnings.length > 0,
        );
      } catch (e) {
        console.warn("[project-io] load failed:", e);
        toast(t("graphIo.toast.loadFailed", {
          source: file.name,
          error: e instanceof Error ? e.message : t("error.unknown"),
        }), true);
      }
    });
    projInput.value = "";
  });
  projLoadLabel.appendChild(projInput);

  host.append(row(projSaveBtn, projLoadLabel));
}
