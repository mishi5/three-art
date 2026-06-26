// #152: シーン参照（SceneInput）の収集・循環検出・評価順（純関数）。
import type { GraphDoc } from "../graph/graph-doc";
import type { NodeRegistry } from "../graph/node-type";

/** グラフ内 SceneInput ノードの参照シーン id（非空）を集める。 */
export function collectSceneRefs(graph: GraphDoc, registry: NodeRegistry): string[] {
  const out: string[] = [];
  for (const n of graph.nodes) {
    const def = registry.get(n.type);
    if (!def?.sceneInput) continue;
    const sid = (n.params as Record<string, unknown>).sceneId;
    if (typeof sid === "string" && sid !== "") out.push(sid);
  }
  return out;
}

type SceneList = ReadonlyArray<{ id: string; graph: GraphDoc }>;

function refMap(scenes: SceneList, registry: NodeRegistry): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const s of scenes) m.set(s.id, collectSceneRefs(s.graph, registry));
  return m;
}

/** from→to の参照を加えるとシーン参照グラフが循環するか（自己参照も true）。 */
export function wouldCreateSceneCycle(
  scenes: SceneList, registry: NodeRegistry, fromSceneId: string, toSceneId: string,
): boolean {
  if (fromSceneId === toSceneId) return true;
  const m = refMap(scenes, registry);
  // to から from へ到達できれば、from→to 追加で循環。
  const stack = [toSceneId];
  const seen = new Set<string>();
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === fromSceneId) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const next of m.get(cur) ?? []) stack.push(next);
  }
  return false;
}

/**
 * activeSceneId から到達する参照先シーンを依存順（leaf 先）で返す（active 自身は含めない）。
 * #174: extraRoots を渡すと、その各シーン（active でなければ）と未評価の参照先も
 * 依存順に追記する（出力シーンを編集と別に評価するため）。重複は排除される。
 */
export function sceneRenderOrder(
  activeSceneId: string, scenes: SceneList, registry: NodeRegistry, extraRoots: string[] = [],
): string[] {
  const m = refMap(scenes, registry);
  const order: string[] = [];
  const done = new Set<string>();
  const onStack = new Set<string>();
  function visit(id: string): void {
    if (done.has(id) || onStack.has(id)) return; // 循環保険: onStack は無視
    onStack.add(id);
    for (const ref of m.get(id) ?? []) visit(ref);
    onStack.delete(id);
    done.add(id);
    if (id !== activeSceneId) order.push(id);
  }
  visit(activeSceneId);
  for (const root of extraRoots) visit(root);
  return order;
}
