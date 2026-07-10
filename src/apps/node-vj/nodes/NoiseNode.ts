import { noise3D } from "../../../core/visuals/value-noise";
import type { NodeState, NodeTypeDef } from "../graph/node-type";

/**
 * #270: Noise のフレーム間状態。sync の立ち上がりで t0 に実効 t を記録し、以後 t-t0 を走査に使う
 * （＝noise3D の走査位置が原点に戻る）。t0 初期値 0 なので sync 未接続時の出力は従来と同一。
 */
export class NoiseRuntime {
  t0 = 0;
  prevSync = false;
}

/** 揺らぎ変調。out = offset + amplitude·noise3D(seed, (t-t0)·speed, 0)（-1..1 ベース）。
 *  sync トリガの立ち上がりで走査位置リセット（#270）。 */
export const NoiseNode: NodeTypeDef = {
  type: "Noise",
  category: "control",
  description: "node.Noise.desc",
  inputs: [
    { id: "t", label: "t", type: "number", description: "node.Noise.port.t" },
    { id: "sync", label: "sync", type: "trigger", description: "node.Noise.port.sync" },
  ],
  outputs: [{ id: "out", label: "out", type: "number" }],
  params: [
    { id: "speed", label: "speed", kind: "number", default: 1, min: 0, max: 5, step: 0.1, description: "node.Noise.param.speed" },
    { id: "seed", label: "seed", kind: "number", default: 1, min: 0, max: 100, step: 1, description: "node.Noise.param.seed" },
    { id: "amplitude", label: "amplitude", kind: "number", default: 1, min: 0, max: 10, step: 0.1, description: "node.Noise.param.amplitude" },
    { id: "offset", label: "offset", kind: "number", default: 0, step: 0.1, description: "node.Noise.param.offset" },
  ],
  createState: () => new NoiseRuntime(),
  evaluate: (ctx) => {
    const t = (ctx.input("t") as number | undefined) ?? ctx.timeSec;
    // #270: sync の立ち上がりエッジで走査位置リセット。state 未生成（旧テスト等）は t0=0 の従来動作。
    let t0 = 0;
    const s = ctx.state as NoiseRuntime | undefined;
    if (s) {
      const sync = Boolean(ctx.input("sync"));
      if (sync && !s.prevSync) s.t0 = t;
      s.prevSync = sync;
      t0 = s.t0;
    }
    const speed = ctx.param("speed") as number;
    const seed = ctx.param("seed") as number;
    const amp = ctx.param("amplitude") as number;
    const offset = ctx.param("offset") as number;
    return { out: offset + amp * noise3D(seed, (t - t0) * speed, 0) };
  },
  disposeState: (_state: NodeState) => { /* no-op（確保資源なし） */ },
};
