import type { NodeTypeDef } from "../graph/node-type";

/** LFO/オシレータ。out = offset + amplitude·sin(2π·freq·t)。t 未接続なら timeSec。 */
export const SineNode: NodeTypeDef = {
  type: "Sine",
  category: "process",
  inputs: [{ id: "t", label: "t", type: "number" }],
  outputs: [{ id: "out", label: "out", type: "number" }],
  params: [
    { id: "freq", label: "freq", kind: "number", default: 0.5, min: 0, max: 10, step: 0.05 },
    { id: "amplitude", label: "amplitude", kind: "number", default: 1, min: 0, max: 10, step: 0.1 },
    { id: "offset", label: "offset", kind: "number", default: 0, step: 0.1 },
  ],
  evaluate: (ctx) => {
    const t = (ctx.input("t") as number | undefined) ?? ctx.timeSec;
    const freq = ctx.param("freq") as number;
    const amp = ctx.param("amplitude") as number;
    const offset = ctx.param("offset") as number;
    return { out: offset + amp * Math.sin(2 * Math.PI * freq * t) };
  },
};
