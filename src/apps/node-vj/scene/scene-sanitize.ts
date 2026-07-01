// #213 起動時のシーン復元をサニタイズする純ロジック。
// SceneStore.load() が返す生の SceneSet は未知ノード型を含みうる（旧ビルド/他環境の
// localStorage）。各シーンの GraphDoc を既存 serializeGraph→deserializeGraph に通して
// 未知ノード・不正接続・未知 param を除去してから採用する（project-file と同パターン）。
import { createGraph, type GraphDoc } from "../graph/graph-doc";
import { serializeGraph, deserializeGraph } from "../graph/serialize";
import type { NodeRegistry } from "../graph/node-type";
import { SCENE_SET_VERSION, type Scene, type SceneSet } from "./scene-store";

export interface SanitizeSceneSetResult {
  /** 健全化した SceneSet。有効シーンが 1 つも残らなければ null。 */
  set: SceneSet | null;
  warnings: string[];
}

/**
 * SceneSet の各シーン graph を deserializeGraph で健全化する純関数。
 * - 各 graph は serializeGraph→deserializeGraph で再検証（未知ノード/不正接続/未知 param を捨て warning）
 * - graph 自体が壊れている（version 不一致等）シーンは空グラフで再生成し warning
 * - id が不正なシーンは捨てる
 * - activeId が生存シーンに無ければ先頭へフォールバックし warning、outputId 不在は null（追従）
 * - 有効シーンが 0 なら set=null（呼び出し側は既定シーンへフォールバックする）
 */
export function sanitizeSceneSet(set: SceneSet, registry: NodeRegistry): SanitizeSceneSetResult {
  const warnings: string[] = [];
  const scenes: Scene[] = [];

  for (const rawScene of set.scenes) {
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
    warnings.push("有効なシーンがありません（既定シーンへフォールバック）");
    return { set: null, warnings };
  }

  // activeId: 生存シーンに存在しなければ先頭へフォールバック。
  let activeId = scenes[0]!.id;
  if (typeof set.activeId === "string" && scenes.some((s) => s.id === set.activeId)) {
    activeId = set.activeId;
  } else {
    warnings.push(`activeId が不正なため先頭シーン（${activeId}）に設定しました`);
  }

  // outputId: 生存シーンに存在すれば採用、無ければ null（編集追従）。
  const outputId =
    typeof set.outputId === "string" && scenes.some((s) => s.id === set.outputId) ? set.outputId : null;

  return { set: { version: SCENE_SET_VERSION, scenes, activeId, outputId }, warnings };
}
