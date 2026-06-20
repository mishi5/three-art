import type { NodeTypeDef } from "../graph/node-type";

/** 経過秒ソース。`timeSec * scale` を出力する。 */
export const TimeNode: NodeTypeDef = {
  type: "Time",
  category: "generator",
  description: "経過秒を出力する時間ソース。timeSec × scale を出力する。",
  inputs: [],
  outputs: [{ id: "out", label: "sec", type: "number" }],
  params: [{ id: "scale", label: "Scale", kind: "number", default: 1, step: 0.1, description: "経過秒に掛ける倍率。大きいほど時間が速く進む（出力 = timeSec × scale）。" }],
  evaluate: (ctx) => ({ out: ctx.timeSec * (ctx.param("scale") as number) }),
};
