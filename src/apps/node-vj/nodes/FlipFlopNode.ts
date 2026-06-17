import type { NodeState, NodeTypeDef } from "../graph/node-type";

/** FlipFlop のフレーム間状態。value は現在の 0/1、prevTrigger でエッジ検出。 */
export class FlipFlopRuntime {
  value: 0 | 1 = 0;
  prevTrigger = false;
  primed = false;
}

/** trigger の発火（立ち上がりエッジ）ごとに 0↔1 を反転する process ノード（#111）。 */
export const FlipFlopNode: NodeTypeDef = {
  type: "FlipFlop",
  category: "process",
  inputs: [{ id: "trigger", label: "trig", type: "trigger" }],
  outputs: [{ id: "out", label: "out", type: "number" }],
  params: [
    { id: "initial", label: "initial", kind: "enum", default: "off", options: ["off", "on"] },
  ],
  createState: () => new FlipFlopRuntime(),
  evaluate: (ctx) => {
    const s = ctx.state as FlipFlopRuntime | undefined;
    if (!s) return { out: 0 };
    if (!s.primed) { s.value = ctx.param("initial") === "on" ? 1 : 0; s.primed = true; }
    const fired = Boolean(ctx.input("trigger"));
    if (fired && !s.prevTrigger) s.value = s.value === 1 ? 0 : 1;  // 立ち上がりエッジで反転
    s.prevTrigger = fired;
    return { out: s.value };
  },
};
