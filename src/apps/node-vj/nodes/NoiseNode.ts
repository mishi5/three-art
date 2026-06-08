import { noise3D } from "../../../core/visuals/value-noise";
import type { NodeTypeDef } from "../graph/node-type";

/** 揺らぎ変調。out = offset + amplitude·noise3D(seed, t·speed, 0)（-1..1 ベース）。 */
export const NoiseNode: NodeTypeDef = {
  type: "Noise",
  category: "process",
  inputs: [{ id: "t", label: "t", type: "number" }],
  outputs: [{ id: "out", label: "out", type: "number" }],
  params: [
    { id: "speed", label: "speed", kind: "number", default: 1, min: 0, max: 5, step: 0.1 },
    { id: "seed", label: "seed", kind: "number", default: 1, min: 0, max: 100, step: 1 },
    { id: "amplitude", label: "amplitude", kind: "number", default: 1, min: 0, max: 10, step: 0.1 },
    { id: "offset", label: "offset", kind: "number", default: 0, step: 0.1 },
  ],
  evaluate: (ctx) => {
    const t = (ctx.input("t") as number | undefined) ?? ctx.timeSec;
    const speed = ctx.param("speed") as number;
    const seed = ctx.param("seed") as number;
    const amp = ctx.param("amplitude") as number;
    const offset = ctx.param("offset") as number;
    return { out: offset + amp * noise3D(seed, t * speed, 0) };
  },
};
