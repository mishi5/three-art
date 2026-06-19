import type { NodeTypeDef } from "../graph/node-type";

/** 2 入力の加算。未接続入力は param 値（既定 0）にフォールバック。 */
export const AddNode: NodeTypeDef = {
  type: "Add",
  category: "process",
  description: "2 入力 a・b を足し合わせて出力する。未接続入力は param 値（既定 0）にフォールバック。",
  inputs: [
    { id: "a", label: "a", type: "number" },
    { id: "b", label: "b", type: "number" },
  ],
  outputs: [{ id: "out", label: "a+b", type: "number" }],
  params: [
    { id: "a", label: "a", kind: "number", default: 0, step: 0.1 },
    { id: "b", label: "b", kind: "number", default: 0, step: 0.1 },
  ],
  evaluate: (ctx) => ({
    out: (ctx.input("a") as number) + (ctx.input("b") as number),
  }),
};
