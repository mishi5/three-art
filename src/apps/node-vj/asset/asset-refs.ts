import type { GraphDoc } from "../graph/graph-doc";

/**
 * グラフ内のアセット参照。slot 省略＝単一 assetId（ImageFileInput 等）、
 * slot あり＝配列 params.padAssets の slot 番目（#205 MidiPad のパッド割当）。
 */
export interface AssetRef { nodeId: string; assetId: string; slot?: number; }

/**
 * グラフ内の各ノードのアセット参照を集める（読込時の復元に使う）。
 * - params.assetId（非空文字列）: 単一アセット（slot 無し）。
 * - params.padAssets（string[] / #205）: 各非空 id を slot=index 付きで集約する。
 */
export function collectAssetRefs(graph: GraphDoc): AssetRef[] {
  const refs: AssetRef[] = [];
  for (const n of graph.nodes) {
    const params = n.params as Record<string, unknown> | undefined;
    const v = params?.assetId;
    if (typeof v === "string" && v !== "") refs.push({ nodeId: n.id, assetId: v });
    const pad = params?.padAssets;
    if (Array.isArray(pad)) {
      pad.forEach((id, i) => {
        if (typeof id === "string" && id !== "") refs.push({ nodeId: n.id, assetId: id, slot: i });
      });
    }
  }
  return refs;
}
