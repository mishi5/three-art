import type { NodeTypeDef } from "../graph/node-type";

/** 経過秒ソース。`timeSec * scale` を出力する。 */
export const TimeNode: NodeTypeDef = {
  type: "Time",
  // 制御信号の時間軸（Sine の t 等を駆動）なので、メディア入口の source ではなく control。
  category: "control",
  description: "node.Time.desc",
  inputs: [],
  outputs: [{ id: "out", label: "sec", type: "number" }],
  params: [{ id: "scale", label: "Scale", kind: "number", default: 1, step: 0.1, description: "node.Time.param.scale" }],
  evaluate: (ctx) => ({ out: ctx.timeSec * (ctx.param("scale") as number) }),
};
