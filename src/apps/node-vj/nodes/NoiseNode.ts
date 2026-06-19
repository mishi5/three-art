import { noise3D } from "../../../core/visuals/value-noise";
import type { NodeTypeDef } from "../graph/node-type";

/** 揺らぎ変調。out = offset + amplitude·noise3D(seed, t·speed, 0)（-1..1 ベース）。 */
export const NoiseNode: NodeTypeDef = {
  type: "Noise",
  category: "process",
  description: "なめらかな揺らぎを生成する。out = offset + amplitude·noise(seed, t·speed)（-1〜1 ベース）。",
  inputs: [{ id: "t", label: "t", type: "number", description: "ノイズの時間軸に使う入力（未接続なら経過秒 timeSec）。" }],
  outputs: [{ id: "out", label: "out", type: "number" }],
  params: [
    { id: "speed", label: "speed", kind: "number", default: 1, min: 0, max: 5, step: 0.1, description: "揺らぎの速さ（時間の進行倍率）。" },
    { id: "seed", label: "seed", kind: "number", default: 1, min: 0, max: 100, step: 1, description: "乱数シード（値を変えると別の揺らぎパターンになる）。" },
    { id: "amplitude", label: "amplitude", kind: "number", default: 1, min: 0, max: 10, step: 0.1, description: "振幅（出力の振れ幅）。" },
    { id: "offset", label: "offset", kind: "number", default: 0, step: 0.1, description: "出力の中心オフセット。" },
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
