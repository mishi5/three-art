// グラフの YAML シリアライズ/デシリアライズ（#65）。
// GraphDoc は純データのため YAML へ素直に書き出し、読込時は registry で検証して
// 未知ノード・不正接続を捨てる（warnings に理由を残す）。
import YAML from "yaml";
import {
  addConnection, createGraph, GRAPH_VERSION,
  type Connection, type GraphDoc, type NodeInstance,
} from "./graph-doc";
import type { NodeRegistry } from "./node-type";

export function serializeGraph(g: GraphDoc): string {
  return YAML.stringify(g);
}

export interface DeserializeResult {
  graph: GraphDoc;
  warnings: string[];
}

/**
 * YAML テキストから GraphDoc を復元する。
 * - version 不一致・YAML 不正・形不正は throw
 * - 未知ノード type は捨てて warning
 * - params は既知 ParamDef にマージ（欠落=default、未知キー=捨てる）
 * - 接続は addConnection で再検証し、不正（型/循環/重複/不在）は捨てて warning
 */
export function deserializeGraph(text: string, registry: NodeRegistry): DeserializeResult {
  const raw = YAML.parse(text) as unknown;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("graph yaml: ルートがオブジェクトではありません");
  }
  const doc = raw as Partial<GraphDoc>;
  if (doc.version !== GRAPH_VERSION) {
    throw new Error(`graph yaml: 未対応の version (${String(doc.version)})`);
  }
  const warnings: string[] = [];
  const graph = createGraph();

  for (const rawNode of doc.nodes ?? []) {
    const n = rawNode as Partial<NodeInstance>;
    if (typeof n.id !== "string" || typeof n.type !== "string") {
      warnings.push(`node を捨てました（id/type が不正）`);
      continue;
    }
    const def = registry.get(n.type);
    if (!def) {
      warnings.push(`node ${n.id} を捨てました（未知 type: ${n.type}）`);
      continue;
    }
    // params: 既知 ParamDef のみ取り込み、欠落は default で補完
    const savedParams = (n.params ?? {}) as Record<string, unknown>;
    const params: Record<string, unknown> = {};
    for (const pd of def.params) {
      params[pd.id] = Object.prototype.hasOwnProperty.call(savedParams, pd.id)
        ? savedParams[pd.id]
        : pd.default;
    }
    const node: NodeInstance = { id: n.id, type: n.type, params };
    if (n.position && typeof n.position.x === "number" && typeof n.position.y === "number") {
      node.position = { x: n.position.x, y: n.position.y };
    }
    if (typeof n.preview === "boolean") node.preview = n.preview;
    graph.nodes.push(node);
  }

  for (const rawConn of doc.connections ?? []) {
    const c = rawConn as Partial<Connection>;
    if (
      typeof c.id !== "string" ||
      !c.from || typeof c.from.node !== "string" || typeof c.from.port !== "string" ||
      !c.to || typeof c.to.node !== "string" || typeof c.to.port !== "string"
    ) {
      warnings.push("connection を捨てました（形が不正）");
      continue;
    }
    const res = addConnection(graph, registry, {
      id: c.id, from: { node: c.from.node, port: c.from.port }, to: { node: c.to.node, port: c.to.port },
    });
    if (!res.ok) {
      warnings.push(`connection ${c.id} を捨てました（${res.reason}）`);
    }
  }

  return { graph, warnings };
}
