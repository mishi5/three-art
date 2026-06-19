import type { NodeTypeDef } from "../graph/node-type";

/** LFO/オシレータ。out = offset + amplitude·sin(2π·freq·t)。t 未接続なら timeSec。 */
export const SineNode: NodeTypeDef = {
  type: "Sine",
  category: "process",
  description: "正弦波 LFO。out = offset + amplitude·sin(2π·freq·t)。t 未接続なら経過秒を使う。",
  inputs: [{ id: "t", label: "t", type: "number", description: "位相に使う時間入力（未接続なら経過秒 timeSec）。" }],
  outputs: [{ id: "out", label: "out", type: "number" }],
  params: [
    { id: "freq", label: "freq", kind: "number", default: 0.5, min: 0, max: 10, step: 0.05, description: "周波数（Hz, 1 秒あたりの振動回数）。" },
    { id: "amplitude", label: "amplitude", kind: "number", default: 1, min: 0, max: 10, step: 0.1, description: "振幅（出力の振れ幅）。" },
    { id: "offset", label: "offset", kind: "number", default: 0, step: 0.1, description: "出力の中心オフセット。" },
  ],
  evaluate: (ctx) => {
    const t = (ctx.input("t") as number | undefined) ?? ctx.timeSec;
    const freq = ctx.param("freq") as number;
    const amp = ctx.param("amplitude") as number;
    const offset = ctx.param("offset") as number;
    return { out: offset + amp * Math.sin(2 * Math.PI * freq * t) };
  },
};
