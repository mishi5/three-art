// pull 評価エンジン（ADR #59）。
// 毎フレーム sink から逆引きでトポロジカル評価し、フレーム内メモ化で各ノードを 1 回だけ評価。
import { findNode, type GraphDoc, type NodeInstance } from "./graph-doc";
import type { EvalContext, NodeEnv, NodeRegistry, NodeState, NodeTypeDef } from "./node-type";
import { effectiveInputPorts, isParamInput } from "./node-ports";
import { applyOutputScales } from "./output-scale";

export interface EvaluateOptions {
  timeSec: number;
  /** visual/sink ノードへ渡すランタイム環境（scene/audio）。 */
  env?: NodeEnv;
  /** ノードの永続状態を引く（GraphRuntime が管理）。 */
  state?: (nodeId: string) => NodeState | undefined;
}

/**
 * グラフを 1 フレーム分評価し、`nodeId → 出力ポート値` を返す。
 * - 未接続の入力ポートは同 id の param 値（なければ ParamDef.default）にフォールバック。
 * - 同一ノードはフレーム内 1 回だけ評価（複数下流からの重複評価を抑制）。
 * - 循環は訪問中スタックで検出し例外を投げる（接続追加時に拒否済みのはずの保険）。
 */
export function evaluate(
  g: GraphDoc,
  registry: NodeRegistry,
  opts: EvaluateOptions,
): Map<string, Record<string, unknown>> {
  const memo = new Map<string, Record<string, unknown>>();
  const visiting = new Set<string>();

  function resolveParam(node: NodeInstance, def: NodeTypeDef, id: string): unknown {
    if (Object.prototype.hasOwnProperty.call(node.params, id)) return node.params[id];
    const pd = def.params.find((p) => p.id === id);
    return pd ? pd.default : undefined;
  }

  function evalNode(nodeId: string): Record<string, unknown> {
    const cached = memo.get(nodeId);
    if (cached) return cached;
    if (visiting.has(nodeId)) throw new Error(`cycle detected at node: ${nodeId}`);
    visiting.add(nodeId);

    const node = findNode(g, nodeId);
    if (!node) throw new Error(`node not found: ${nodeId}`);
    // #213 多層防御: 未知ノード型は throw せずスキップ（出力なし）。復元サニタイズを
    // すり抜けた未知 type が残っても tick ループごとクラッシュしないようにする。
    const def = registry.get(node.type);
    if (!def) {
      visiting.delete(nodeId);
      const empty: Record<string, unknown> = {};
      memo.set(nodeId, empty);
      return empty;
    }

    // 実効入力（signal ∪ 数値 param）を解決。接続あり→上流値、なし→手動 param（あれば）。
    const inputValues = new Map<string, unknown>();
    for (const port of effectiveInputPorts(def)) {
      const c = g.connections.find((c) => c.to.node === nodeId && c.to.port === port.id);
      if (c) {
        const upstream = evalNode(c.from.node);
        inputValues.set(port.id, upstream[c.from.port]);
      } else {
        inputValues.set(port.id, resolveParam(node, def, port.id));
      }
    }

    const ctx: EvalContext = {
      timeSec: opts.timeSec,
      input: (id) => inputValues.get(id),
      // 数値 param は接続時に上流値で上書き（#74）。enum/boolean 等は手動値のまま。
      param: (id) => (isParamInput(def, id) ? inputValues.get(id) : resolveParam(node, def, id)),
      node,
      state: opts.state?.(nodeId),
      env: opts.env,
    };
    const outputs = def.evaluate(ctx);
    // #208: number 出力ポートの倍率を適用してから記録・下流伝播する。
    // 倍率なし/既定 1 のときは applyOutputScales が同じ参照を返す（＝従来と完全に同じ挙動）。
    const scaled = applyOutputScales(outputs, def, node.outputScales);

    visiting.delete(nodeId);
    memo.set(nodeId, scaled);
    return scaled;
  }

  for (const sink of getSinks(g, registry)) evalNode(sink.id);
  return memo;
}

/** sink = isSink フラグ付き、または出力辺を持たないノード。 */
export function getSinks(g: GraphDoc, registry: NodeRegistry): NodeInstance[] {
  const hasOutgoing = new Set(g.connections.map((c) => c.from.node));
  return g.nodes.filter((n) => {
    const def = registry.get(n.type);
    return Boolean(def?.isSink) || !hasOutgoing.has(n.id);
  });
}
