// グラフのデータモデル（保存単位）と操作（ADR #59）。
// NodeInstance / Connection / GraphDoc は純データ（関数を持たない）→ JSON 化可能。
import type { NodeRegistry } from "./node-type";
import { isCompatible } from "./port-types";
import { effectiveInputPorts } from "./node-ports";

export interface NodeInstance {
  id: string;
  type: string;
  params: Record<string, unknown>;
  position?: { x: number; y: number };
}

export interface Connection {
  id: string;
  from: { node: string; port: string };
  to: { node: string; port: string };
}

export interface GraphDoc {
  version: number;
  nodes: NodeInstance[];
  connections: Connection[];
}

export const GRAPH_VERSION = 1;

export function createGraph(): GraphDoc {
  return { version: GRAPH_VERSION, nodes: [], connections: [] };
}

export function findNode(g: GraphDoc, id: string): NodeInstance | undefined {
  return g.nodes.find((n) => n.id === id);
}

export function addNode(g: GraphDoc, node: NodeInstance): void {
  if (findNode(g, node.id)) throw new Error(`duplicate node id: ${node.id}`);
  g.nodes.push(node);
}

/** ノードと、それに接続された全コネクションを削除する。 */
export function removeNode(g: GraphDoc, nodeId: string): void {
  g.nodes = g.nodes.filter((n) => n.id !== nodeId);
  g.connections = g.connections.filter(
    (c) => c.from.node !== nodeId && c.to.node !== nodeId,
  );
}

export function removeConnection(g: GraphDoc, connId: string): void {
  g.connections = g.connections.filter((c) => c.id !== connId);
}

export interface ConnectResult {
  ok: boolean;
  reason?: string;
}

/**
 * 接続を追加する。以下を検査し、不正なら追加せず reason を返す:
 * - 自己接続 / ノード・ポート不在 / 型不一致 / 入力ポート重複 / 循環(DAG 違反)。
 */
export function addConnection(
  g: GraphDoc,
  registry: NodeRegistry,
  conn: Connection,
): ConnectResult {
  if (conn.from.node === conn.to.node) {
    return { ok: false, reason: "self-connection" };
  }
  const fromNode = findNode(g, conn.from.node);
  const toNode = findNode(g, conn.to.node);
  if (!fromNode || !toNode) return { ok: false, reason: "node not found" };

  const fromDef = registry.get(fromNode.type);
  const toDef = registry.get(toNode.type);
  if (!fromDef || !toDef) return { ok: false, reason: "node type not found" };

  const outPort = fromDef.outputs.find((p) => p.id === conn.from.port);
  // 数値 param も実効入力ポートとして接続を受け付ける（#74）。
  const inPort = effectiveInputPorts(toDef).find((p) => p.id === conn.to.port);
  if (!outPort || !inPort) return { ok: false, reason: "port not found" };

  if (!isCompatible(outPort.type, inPort.type)) {
    return { ok: false, reason: "type mismatch" };
  }

  // 入力ポートは 1 本のみ（重複入力を禁止）。
  const occupied = g.connections.some(
    (c) => c.to.node === conn.to.node && c.to.port === conn.to.port,
  );
  if (occupied) return { ok: false, reason: "input already connected" };

  if (wouldCreateCycle(g, conn.from.node, conn.to.node)) {
    return { ok: false, reason: "cycle" };
  }

  g.connections.push(conn);
  return { ok: true };
}

/**
 * `from → to` の辺を加えると循環するか。
 * 既存の辺だけをたどって `to` から `from` に到達できれば循環になる。
 */
export function wouldCreateCycle(g: GraphDoc, from: string, to: string): boolean {
  const adj = new Map<string, string[]>();
  for (const c of g.connections) {
    const list = adj.get(c.from.node) ?? [];
    list.push(c.to.node);
    adj.set(c.from.node, list);
  }
  const stack = [to];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (cur === from) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const next of adj.get(cur) ?? []) stack.push(next);
  }
  return false;
}

/**
 * 既存 GraphDoc の中身を loaded で置き換える（参照を維持したまま読込を反映する）。
 * editor / runtime は同じ GraphDoc を参照し続けるため、再配線が不要になる。
 */
export function replaceGraph(target: GraphDoc, loaded: GraphDoc): void {
  target.version = loaded.version;
  target.nodes = loaded.nodes;
  target.connections = loaded.connections;
}
