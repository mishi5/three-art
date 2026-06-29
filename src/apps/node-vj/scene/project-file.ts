// #201 プロジェクト（全シーン状態）の YAML シリアライズ/デシリアライズ。
// SceneSet（全シーンの GraphDoc + activeId + outputId）を 1 ファイルにまとめて保存/復元する。
// 各シーンの graph は既存 serializeGraph/deserializeGraph を再利用して検証する（#65）。
// アセットのバイナリは含めない（GraphDoc の params.assetId 参照のみ。復元は restoreAssets が担う）。
import YAML from "yaml";
import { createGraph, type GraphDoc } from "../graph/graph-doc";
import { serializeGraph, deserializeGraph } from "../graph/serialize";
import type { NodeRegistry } from "../graph/node-type";
import { SCENE_SET_VERSION, type Scene, type SceneSet } from "./scene-store";

/** プロジェクトファイルの形式バージョン（後方互換の判定に使う）。 */
export const PROJECT_VERSION = 1;

/** ファイルに書き出す素の形（YAML のルート）。 */
interface ProjectFile {
  version: number;
  activeId: string;
  outputId: string | null;
  scenes: Scene[];
}

/** SceneSet を PROJECT_VERSION 付きの YAML 文字列にする。graph は GraphDoc をそのまま埋め込む。 */
export function serializeProject(set: SceneSet): string {
  const doc: ProjectFile = {
    version: PROJECT_VERSION,
    activeId: set.activeId,
    outputId: set.outputId ?? null,
    scenes: set.scenes.map((s) => ({ id: s.id, name: s.name, graph: s.graph })),
  };
  return YAML.stringify(doc);
}

export interface DeserializeProjectResult {
  project: SceneSet;
  warnings: string[];
}

/**
 * YAML テキストから SceneSet を復元する。
 * - YAML 破損・ルート非オブジェクト・version 不一致・scenes 欠落/空 は throw
 * - 各シーンの graph は deserializeGraph で検証（未知ノード/不正接続/未知 param を捨て warning）
 * - graph 自体が壊れている（version 不一致等）シーンは空グラフで再生成し warning
 * - activeId が scenes に無ければ先頭へフォールバックし warning、outputId 不在は null（追従）
 */
export function deserializeProject(text: string, registry: NodeRegistry): DeserializeProjectResult {
  const raw = YAML.parse(text) as unknown;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("project yaml: ルートがオブジェクトではありません");
  }
  const doc = raw as Partial<ProjectFile>;
  if (doc.version !== PROJECT_VERSION) {
    throw new Error(`project yaml: 未対応の version (${String(doc.version)})`);
  }
  if (!Array.isArray(doc.scenes) || doc.scenes.length === 0) {
    throw new Error("project yaml: scenes がありません");
  }

  const warnings: string[] = [];
  const scenes: Scene[] = [];
  for (const rawScene of doc.scenes) {
    const sc = rawScene as Partial<Scene>;
    if (typeof sc.id !== "string" || sc.id === "") {
      warnings.push("scene を捨てました（id が不正）");
      continue;
    }
    const name = typeof sc.name === "string" && sc.name !== "" ? sc.name : sc.id;
    // graph は serializeGraph→deserializeGraph で再検証する（既存の健全化ロジックを再利用）。
    let graph: GraphDoc;
    try {
      const graphText = serializeGraph((sc.graph ?? createGraph()) as GraphDoc);
      const res = deserializeGraph(graphText, registry);
      graph = res.graph;
      for (const w of res.warnings) warnings.push(`scene ${sc.id}: ${w}`);
    } catch (e) {
      warnings.push(`scene ${sc.id}: graph を初期化しました（${e instanceof Error ? e.message : "不明なエラー"}）`);
      graph = createGraph();
    }
    scenes.push({ id: sc.id, name, graph });
  }
  if (scenes.length === 0) {
    throw new Error("project yaml: 有効なシーンがありません");
  }

  // activeId: scenes に存在しなければ先頭へフォールバック。
  let activeId = scenes[0]!.id;
  if (typeof doc.activeId === "string" && scenes.some((s) => s.id === doc.activeId)) {
    activeId = doc.activeId;
  } else {
    warnings.push(`activeId が不正なため先頭シーン（${activeId}）に設定しました`);
  }

  // outputId: scenes に存在すれば採用、無ければ null（編集追従）。
  const outputId =
    typeof doc.outputId === "string" && scenes.some((s) => s.id === doc.outputId) ? doc.outputId : null;

  const project: SceneSet = { version: SCENE_SET_VERSION, scenes, activeId, outputId };
  return { project, warnings };
}

/** 保存ファイル名 `node-vj-project-YYYYMMDD-HHMMSS.yaml`（ローカル時刻）。 */
export function projectFileName(date: Date): string {
  const p = (n: number, w = 2): string => String(n).padStart(w, "0");
  const stamp =
    `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}` +
    `-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
  return `node-vj-project-${stamp}.yaml`;
}
