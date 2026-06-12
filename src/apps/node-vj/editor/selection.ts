// 矩形選択の判定（#83・純粋）。ドラッグ矩形と交差するノード id を返す。
import type { NodeInstance } from "../graph/graph-doc";
import type { NodeRegistry } from "../graph/node-type";
import { nodeRect } from "./layout";

export interface Rect { x: number; y: number; w: number; h: number }

/** 2 点から正規化された矩形（負の幅高さを吸収）。 */
export function normRect(x0: number, y0: number, x1: number, y1: number): Rect {
  return {
    x: Math.min(x0, x1), y: Math.min(y0, y1),
    w: Math.abs(x1 - x0), h: Math.abs(y1 - y0),
  };
}

/** 矩形と交差するノードの id 群。 */
export function nodesInRect(
  nodes: ReadonlyArray<NodeInstance>,
  registry: NodeRegistry,
  rect: Rect,
): string[] {
  const out: string[] = [];
  for (const node of nodes) {
    const def = registry.get(node.type);
    if (!def) continue;
    const r = nodeRect(node, def);
    const hit = rect.x < r.x + r.w && rect.x + rect.w > r.x &&
                rect.y < r.y + r.h && rect.y + rect.h > r.y;
    if (hit) out.push(node.id);
  }
  return out;
}
