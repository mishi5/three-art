import type { NodeState, NodeTypeDef } from "../graph/node-type";

/**
 * #270: Sine のフレーム間状態。sync の立ち上がりで t0 に実効 t を記録し、以後 t-t0 で発振する
 * （＝位相 0・sin の立ち上がりから再開）。t0 初期値 0 なので sync 未接続時の出力は従来と同一。
 */
export class SineRuntime {
  t0 = 0;
  prevSync = false;
}

/** LFO/オシレータ。out = offset + amplitude·sin(2π·freq·(t-t0))。t 未接続なら timeSec。
 *  sync トリガの立ち上がりで位相リセット（#270・BeatClock.beat を繋ぐと拍頭同期 LFO になる）。 */
export const SineNode: NodeTypeDef = {
  type: "Sine",
  category: "control",
  description: "node.Sine.desc",
  inputs: [
    { id: "t", label: "t", type: "number", description: "node.Sine.port.t" },
    { id: "sync", label: "sync", type: "trigger", description: "node.Sine.port.sync" },
  ],
  outputs: [{ id: "out", label: "out", type: "number" }],
  params: [
    { id: "freq", label: "freq", kind: "number", default: 0.5, min: 0, max: 10, step: 0.05, description: "node.Sine.param.freq" },
    { id: "amplitude", label: "amplitude", kind: "number", default: 1, min: 0, max: 10, step: 0.1, description: "node.Sine.param.amplitude" },
    { id: "offset", label: "offset", kind: "number", default: 0, step: 0.1, description: "node.Sine.param.offset" },
  ],
  createState: () => new SineRuntime(),
  evaluate: (ctx) => {
    const t = (ctx.input("t") as number | undefined) ?? ctx.timeSec;
    // #270: sync の立ち上がりエッジで位相リセット。state 未生成（旧テスト等）は t0=0 の従来動作。
    let t0 = 0;
    const s = ctx.state as SineRuntime | undefined;
    if (s) {
      const sync = Boolean(ctx.input("sync"));
      if (sync && !s.prevSync) s.t0 = t;
      s.prevSync = sync;
      t0 = s.t0;
    }
    const freq = ctx.param("freq") as number;
    const amp = ctx.param("amplitude") as number;
    const offset = ctx.param("offset") as number;
    return { out: offset + amp * Math.sin(2 * Math.PI * freq * (t - t0)) };
  },
  disposeState: (_state: NodeState) => { /* no-op（確保資源なし） */ },
};
