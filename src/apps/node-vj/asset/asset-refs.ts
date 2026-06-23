import type { GraphDoc } from "../graph/graph-doc";

export interface AssetRef { nodeId: string; assetId: string; }

/** グラフ内の各ノードの params.assetId（非空文字列）を参照として集める。読込時の復元に使う。 */
export function collectAssetRefs(graph: GraphDoc): AssetRef[] {
  const refs: AssetRef[] = [];
  for (const n of graph.nodes) {
    const v = (n.params as Record<string, unknown> | undefined)?.assetId;
    if (typeof v === "string" && v !== "") refs.push({ nodeId: n.id, assetId: v });
  }
  return refs;
}
