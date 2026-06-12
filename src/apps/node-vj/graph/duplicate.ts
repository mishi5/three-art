// ノード複製（#83・純粋ロジック）。
// 選択ノード群を +offset 位置に新 id で複製し、エッジは次の規則で扱う:
//   選択内→選択内: 複製ノード間に張り直す
//   選択外→選択内（入力側）: 維持して複製（出力はファンアウト可能なので安全）
//   選択内→選択外（出力側）: 複製しない（外部入力ポートを後勝ちで奪い元の接続を壊すため）
// 有効なグラフの部分複製は有効なので registry 検証は不要。
import type { GraphDoc } from "./graph-doc";

export function duplicateNodes(
  g: GraphDoc,
  ids: ReadonlySet<string>,
  genId: (prefix: string) => string,
  offset: number,
): string[] {
  const idMap = new Map<string, string>(); // 元 id → 複製 id
  for (const node of g.nodes) {
    if (!ids.has(node.id)) continue;
    const cloneId = genId("n");
    idMap.set(node.id, cloneId);
    g.nodes.push({
      id: cloneId,
      type: node.type,
      params: structuredClone(node.params),
      ...(node.position
        ? { position: { x: node.position.x + offset, y: node.position.y + offset } }
        : {}),
      ...(node.preview !== undefined ? { preview: node.preview } : {}),
    });
  }
  if (idMap.size === 0) return [];

  // エッジ複製（元のエッジ配列を走査。push する複製エッジは対象外になるよう先にスナップショット）
  for (const conn of [...g.connections]) {
    const fromClone = idMap.get(conn.from.node);
    const toClone = idMap.get(conn.to.node);
    if (toClone === undefined) continue;           // 内→外 or 無関係 → 複製しない
    g.connections.push({
      id: genId("c"),
      from: { node: fromClone ?? conn.from.node, port: conn.from.port }, // 内→内 or 外→内
      to: { node: toClone, port: conn.to.port },
    });
  }
  return [...idMap.values()];
}
