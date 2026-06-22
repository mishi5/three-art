import type { GraphDoc } from "../graph/graph-doc";
import type { NodeRegistry } from "../graph/node-type";
import { fileRowRect } from "../editor/layout";

/** ワールド座標 (x,y) が乗っているファイル行ノードの id を返す。割当 D&D の drop 先判定。 */
export function assetDropTarget(graph: GraphDoc, registry: NodeRegistry, x: number, y: number): string | null {
  for (const node of graph.nodes) {
    const def = registry.get(node.type);
    if (!def?.fileInput) continue;
    const r = fileRowRect(node, def);
    if (r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return node.id;
  }
  return null;
}
