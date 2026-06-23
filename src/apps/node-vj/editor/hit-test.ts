// 統一ヒットテスト（#80）。
// ポインタ位置のヒットを「最前面ノードがイベントを所有する」遮蔽つきで解決する。
// 旧実装は port/param/node を別々に全ノード走査しており、走査順の不一致で
// 手前ノードのタイトル越しに背後ノードの param 行へヒットするバグがあった。
import type { NodeInstance } from "../graph/graph-doc";
import type { NodeRegistry, NodeTypeDef } from "../graph/node-type";
import type { PortType } from "../graph/port-types";
import { signalInputs, isConnectableParam } from "../graph/node-ports";
import {
  PORT_R, nodeRect, inputPortPos, outputPortPos, paramPortPos, paramRowY, ROW_H, dist2,
} from "./layout";

/** ドットのヒット半径（描画半径より少し甘め）。 */
const HIT_R = PORT_R + 4;
const HIT_R2 = HIT_R * HIT_R;

export type HitResult =
  | { kind: "port"; node: NodeInstance; port: string; portKind: "input" | "output"; type: PortType }
  | { kind: "param"; node: NodeInstance; paramIndex: number }
  | { kind: "node"; node: NodeInstance }
  | null;

/**
 * world 座標 (wx,wy) のヒットを解決する。
 * 最前面（配列後方）から走査し、各ノードについて:
 *  1. ポートドット（signal 入力 / 出力 / param 入力）に当たれば port
 *  2. ノード矩形内なら param 行 or 本体（ここで確定。下のノードへは行かない＝遮蔽）
 *  3. ドット余白にしか掛かっていなければ下のノードへ継続
 */
export function hitTest(
  nodes: ReadonlyArray<NodeInstance>,
  registry: NodeRegistry,
  wx: number,
  wy: number,
): HitResult {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i]!;
    const def = registry.get(node.type);
    if (!def) continue;
    const r = nodeRect(node, def);
    // ドットは左右辺の中心に乗り ±HIT_R はみ出すため、横方向に膨らませて粗判定。
    if (wx < r.x - HIT_R || wx > r.x + r.w + HIT_R || wy < r.y - HIT_R || wy > r.y + r.h + HIT_R) {
      continue;
    }

    const port = portAt(node, def, wx, wy);
    if (port) return port;

    const insideRect = wx >= r.x && wx <= r.x + r.w && wy >= r.y && wy <= r.y + r.h;
    if (insideRect) {
      // param 行（ドット以外の領域）。#154: hidden param は行を持たないので除外。
      for (let pi = 0; pi < def.params.length; pi++) {
        if (def.params[pi]!.hidden) continue;
        if (Math.abs(wy - paramRowY(node, def, pi)) <= ROW_H / 2) {
          return { kind: "param", node, paramIndex: pi };
        }
      }
      // タイトル/本体。最前面ノードの矩形がイベントを所有し、下は遮蔽される。
      return { kind: "node", node };
    }
    // ドット余白のみ → このノードは素通りし、下のノードを見る。
  }
  return null;
}

/** ノード 1 つ分のポートドット判定。 */
function portAt(node: NodeInstance, def: NodeTypeDef, wx: number, wy: number): HitResult {
  const sig = signalInputs(def);
  for (let i = 0; i < sig.length; i++) {
    const p = inputPortPos(node, i);
    if (dist2(wx, wy, p.x, p.y) <= HIT_R2) {
      return { kind: "port", node, port: sig[i]!.id, portKind: "input", type: sig[i]!.type };
    }
  }
  for (let i = 0; i < def.outputs.length; i++) {
    const p = outputPortPos(node, i);
    if (dist2(wx, wy, p.x, p.y) <= HIT_R2) {
      return { kind: "port", node, port: def.outputs[i]!.id, portKind: "output", type: def.outputs[i]!.type };
    }
  }
  for (let i = 0; i < def.params.length; i++) {
    if (def.params[i]!.hidden || !isConnectableParam(def.params[i]!)) continue;
    const p = paramPortPos(node, def, i);
    if (dist2(wx, wy, p.x, p.y) <= HIT_R2) {
      return { kind: "port", node, port: def.params[i]!.id, portKind: "input", type: "number" };
    }
  }
  return null;
}
