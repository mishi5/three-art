import type { NodeTypeDef } from "../graph/node-type";
import { remap } from "./process-logic";

/** 範囲変換。in を [inMin,inMax] から [outMin,outMax] へ写す（clamp 可）。 */
export const RemapNode: NodeTypeDef = {
  type: "Remap",
  category: "control",
  description: "node.Remap.desc",
  inputs: [{ id: "in", label: "in", type: "number" }],
  outputs: [{ id: "out", label: "out", type: "number" }],
  params: [
    { id: "inMin", label: "inMin", kind: "number", default: 0, step: 0.1, description: "node.Remap.param.inMin" },
    { id: "inMax", label: "inMax", kind: "number", default: 1, step: 0.1, description: "node.Remap.param.inMax" },
    { id: "outMin", label: "outMin", kind: "number", default: 0, step: 0.1, description: "node.Remap.param.outMin" },
    { id: "outMax", label: "outMax", kind: "number", default: 1, step: 0.1, description: "node.Remap.param.outMax" },
    { id: "clamp", label: "clamp", kind: "boolean", default: true, description: "node.Remap.param.clamp" },
  ],
  evaluate: (ctx) => {
    const v = (ctx.input("in") as number | undefined) ?? 0;
    return {
      out: remap(
        v,
        ctx.param("inMin") as number, ctx.param("inMax") as number,
        ctx.param("outMin") as number, ctx.param("outMax") as number,
        Boolean(ctx.param("clamp")),
      ),
    };
  },
};
