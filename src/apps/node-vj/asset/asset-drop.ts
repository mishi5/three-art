import type { GraphDoc } from "../graph/graph-doc";
import type { NodeRegistry } from "../graph/node-type";
import type { AssetKind } from "./asset-kind";
import { nodeRect } from "../editor/layout";

/**
 * ワールド座標 (x,y) が乗っているファイル入力ノードの id を返す。割当 D&D の drop 先判定。
 * #154: ファイル選択行だけでなくノード本体全体を判定対象にする（最前面＝配列後方を優先）。
 */
export function assetDropTarget(graph: GraphDoc, registry: NodeRegistry, x: number, y: number): string | null {
  for (let i = graph.nodes.length - 1; i >= 0; i--) {
    const node = graph.nodes[i]!;
    const def = registry.get(node.type);
    if (!def?.fileInput) continue;
    const r = nodeRect(node, def);
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return node.id;
  }
  return null;
}

/** #154: アセット種別に対応するファイル入力ノード型（空白ドロップでの自動生成用）。 */
export function nodeTypeForKind(kind: AssetKind): string {
  switch (kind) {
    case "image": return "ImageFileInput";
    case "video": return "VideoFileInput";
    case "audio": return "AudioFileInput";
  }
}
