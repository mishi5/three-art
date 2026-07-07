import type { NodeTypeDef } from "../graph/node-type";

/** 経過秒ソース。`timeSec * scale` を出力する。 */
export const TimeNode: NodeTypeDef = {
  type: "Time",
  category: "generator",
  description: "node.Time.desc",
  inputs: [],
  outputs: [{ id: "out", label: "sec", type: "number" }],
  params: [{ id: "scale", label: "Scale", kind: "number", default: 1, step: 0.1, description: "node.Time.param.scale" }],
  evaluate: (ctx) => ({ out: ctx.timeSec * (ctx.param("scale") as number) }),
};
