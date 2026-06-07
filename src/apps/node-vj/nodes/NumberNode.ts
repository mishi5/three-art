import type { NodeTypeDef } from "../graph/node-type";

/** 定数 number ソース。param `value` を出力する。 */
export const NumberNode: NodeTypeDef = {
  type: "Number",
  category: "input",
  inputs: [],
  outputs: [{ id: "out", label: "n", type: "number" }],
  params: [{ id: "value", label: "Value", kind: "number", default: 1, step: 0.1 }],
  evaluate: (ctx) => ({ out: ctx.param("value") as number }),
};
