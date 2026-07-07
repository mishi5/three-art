import type { NodeTypeDef } from "../graph/node-type";

/** 定数 number ソース。param `value` を出力する。🎲ボタンで min〜max のランダム値に再ロールできる（#150）。 */
export const NumberNode: NodeTypeDef = {
  type: "Number",
  category: "source",
  description: "node.Number.desc",
  inputs: [],
  outputs: [{ id: "out", label: "n", type: "number" }],
  // 固定値を出力するためだけのノードなので value/min/max は入力ポートを持たない。
  params: [
    { id: "value", label: "Value", kind: "number", default: 1, step: 0.1, noInput: true },
    { id: "min", label: "min", kind: "number", default: 0, step: 0.1, noInput: true, description: "node.Number.param.min" },
    { id: "max", label: "max", kind: "number", default: 1, step: 0.1, noInput: true, description: "node.Number.param.max" },
  ],
  randomButton: { paramId: "value" },
  evaluate: (ctx) => ({ out: ctx.param("value") as number }),
};
