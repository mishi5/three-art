import type { NodeState, NodeTypeDef } from "../graph/node-type";

/** EMA 平滑ノードのフレーム間状態。 */
export class SmoothRuntime {
  prev = 0;
  primed = false;
}

/** EMA 平滑。out += (in - out)·factor。factor=1 で即追従、0 で固定。 */
export const SmoothNode: NodeTypeDef = {
  type: "Smooth",
  category: "process",
  description: "入力の急変を平滑化する（指数移動平均）。out += (in - out)·factor。",
  inputs: [{ id: "in", label: "in", type: "number" }],
  outputs: [{ id: "out", label: "out", type: "number" }],
  params: [
    { id: "factor", label: "factor", kind: "number", default: 0.1, min: 0, max: 1, step: 0.01, description: "追従係数。1 で即追従、0 で固定（小さいほど滑らか）。" },
  ],
  // env は使わないが、フレーム間状態のため createState を持つ。
  createState: () => new SmoothRuntime(),
  evaluate: (ctx) => {
    const s = ctx.state as SmoothRuntime | undefined;
    const v = (ctx.input("in") as number | undefined) ?? 0;
    if (!s) return { out: v };
    const factor = Math.max(0, Math.min(1, ctx.param("factor") as number));
    // 初回は入力値で初期化（0 からの立ち上がりを避ける）。
    if (!s.primed) { s.prev = v; s.primed = true; }
    else s.prev += (v - s.prev) * factor;
    return { out: s.prev };
  },
};
