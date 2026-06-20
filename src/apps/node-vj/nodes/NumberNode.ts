import type { NodeTypeDef } from "../graph/node-type";

/** 定数 number ソース。param `value` を出力する。 */
export const NumberNode: NodeTypeDef = {
  type: "Number",
  category: "generator",
  description: "固定の数値を出力する定数ソース。param value をそのまま出力する。",
  inputs: [],
  outputs: [{ id: "out", label: "n", type: "number" }],
  // 固定値を出力するためだけのノードなので value は入力ポートを持たない。
  params: [{ id: "value", label: "Value", kind: "number", default: 1, step: 0.1, noInput: true }],
  evaluate: (ctx) => ({ out: ctx.param("value") as number }),
};
