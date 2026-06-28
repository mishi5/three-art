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
  /** #77: ノード横プレビュー小窓の ON/OFF（texture 出力を持つノードのみ意味を持つ）。 */
  preview?: boolean;
  /** #176: ノード名（ユーザが付ける名前。グループ名に近い注釈。ノード上部に表示）。 */
  name?: string;
  /**
   * #208: number 型出力ポート単位の倍率（スケール）。portId → 倍率。
   * 評価器が出力値に掛けてから下流へ渡す。未設定/1 は従来と同じ挙動（params とは別管理）。
   */
  outputScales?: Record<string, number>;
}

/** #176: エディタ上の自由ラベル（付箋）。x/y は world 座標。 */
export interface TextLabel {
  id: string;
  x: number;
  y: number;
  text: string;
}

export interface Connection {
  id: string;
  from: { node: string; port: string };
  to: { node: string; port: string };
}

/** #175: ノードのグループ（まとめて選択・移動する塊）。name は #176 ラベルで活用。 */
export interface NodeGroup {
  id: string;
  name?: string;
  nodeIds: string[];
}

export interface GraphDoc {
  version: number;
  nodes: NodeInstance[];
  connections: Connection[];
  /** #175: ノードグループ（任意）。 */
  groups?: NodeGroup[];
  /** #176: エディタ上の自由ラベル（任意）。 */
  labels?: TextLabel[];
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

/** ノードと、それに接続された全コネクションを削除する。#175: 所属グループからも除去し、2 未満は解散。 */
export function removeNode(g: GraphDoc, nodeId: string): void {
  g.nodes = g.nodes.filter((n) => n.id !== nodeId);
  g.connections = g.connections.filter(
    (c) => c.from.node !== nodeId && c.to.node !== nodeId,
  );
  if (g.groups) {
    for (const gr of g.groups) gr.nodeIds = gr.nodeIds.filter((id) => id !== nodeId);
    g.groups = g.groups.filter((gr) => gr.nodeIds.length >= 2);
    if (g.groups.length === 0) delete g.groups;
  }
}

/** #175: 指定ノード id 群でグループを作る（2 件未満は作らない。既存グループ所属ノードは新グループへ移す）。 */
export function createGroup(g: GraphDoc, id: string, nodeIds: string[], name?: string): void {
  const ids = [...new Set(nodeIds)].filter((nid) => findNode(g, nid));
  if (ids.length < 2) return;
  const set = new Set(ids);
  const groups = g.groups ?? [];
  // 既存グループから重複ノードを除去し、2 未満になったグループは解散。
  for (const gr of groups) gr.nodeIds = gr.nodeIds.filter((nid) => !set.has(nid));
  const kept = groups.filter((gr) => gr.nodeIds.length >= 2);
  kept.push({ id, name, nodeIds: ids });
  g.groups = kept;
}

/** #175: グループを削除する。 */
export function removeGroup(g: GraphDoc, groupId: string): void {
  if (!g.groups) return;
  g.groups = g.groups.filter((gr) => gr.id !== groupId);
  if (g.groups.length === 0) delete g.groups;
}

/** #175: ノードが所属するグループを返す（無ければ undefined）。 */
export function groupOfNode(g: GraphDoc, nodeId: string): NodeGroup | undefined {
  return g.groups?.find((gr) => gr.nodeIds.includes(nodeId));
}

/** #176: 自由ラベルを追加する。 */
export function addLabel(g: GraphDoc, label: TextLabel): void {
  (g.labels ??= []).push(label);
}

/** #176: 自由ラベルを削除する。 */
export function removeLabel(g: GraphDoc, id: string): void {
  if (!g.labels) return;
  g.labels = g.labels.filter((l) => l.id !== id);
  if (g.labels.length === 0) delete g.labels;
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

  // 入力ポートは 1 本のみ。接続済みなら後勝ちで置き換える（#84）。
  // 循環チェックは「置き換えで消える既存エッジ」を除外して行い、
  // 循環になる場合は拒否して既存接続を維持する。
  const existing = g.connections.find(
    (c) => c.to.node === conn.to.node && c.to.port === conn.to.port,
  );
  if (wouldCreateCycle(g, conn.from.node, conn.to.node, existing?.id)) {
    return { ok: false, reason: "cycle" };
  }
  if (existing) removeConnection(g, existing.id);

  g.connections.push(conn);
  return { ok: true };
}

/**
 * `from → to` の辺を加えると循環するか。
 * 既存の辺だけをたどって `to` から `from` に到達できれば循環になる。
 * excludeConnId は後勝ち置き換え（#84）で消える予定の辺を除外する。
 */
export function wouldCreateCycle(g: GraphDoc, from: string, to: string, excludeConnId?: string): boolean {
  const adj = new Map<string, string[]>();
  for (const c of g.connections) {
    if (c.id === excludeConnId) continue;
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
  if (loaded.groups) target.groups = loaded.groups; else delete target.groups; // #175
  if (loaded.labels) target.labels = loaded.labels; else delete target.labels; // #176
}
