import type { NodeTypeDef } from "../graph/node-type";

/** 2 入力の乗算。未接続入力は param 値（既定 1）にフォールバック。 */
export const MultiplyNode: NodeTypeDef = {
  type: "Multiply",
  category: "process",
  inputs: [
    { id: "a", label: "a", type: "number" },
    { id: "b", label: "b", type: "number" },
  ],
  outputs: [{ id: "out", label: "a×b", type: "number" }],
  params: [
    { id: "a", label: "a", kind: "number", default: 1, step: 0.1 },
    { id: "b", label: "b", kind: "number", default: 1, step: 0.1 },
  ],
  evaluate: (ctx) => ({
    out: (ctx.input("a") as number) * (ctx.input("b") as number),
  }),
};
