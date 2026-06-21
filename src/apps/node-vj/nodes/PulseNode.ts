import type { NodeState, NodeTypeDef } from "../graph/node-type";
import { pulseStep } from "./param-gen-logic";

/** Pulse のフレーム間状態。lastFire は最後に発火した時刻（秒）。 */
export class PulseRuntime {
  lastFire = 0;
  primed = false;
}

/** 一定間隔で trigger を定期発火するジェネレータ（#155）。Pulse→各種 trigger 入力へ。 */
export const PulseNode: NodeTypeDef = {
  type: "Pulse",
  category: "generator",
  description: "一定間隔（interval 秒）で trigger を発火し続けるメトロノーム的ジェネレータ。",
  inputs: [],
  outputs: [{ id: "trigger", label: "trig", type: "trigger", description: "interval ごとに 1 フレーム発火する trigger。" }],
  params: [
    { id: "interval", label: "interval", kind: "number", default: 0.5, min: 0.02, max: 10, step: 0.01, description: "発火間隔（秒）。" },
  ],
  createState: () => new PulseRuntime(),
  evaluate: (ctx) => {
    const s = ctx.state as PulseRuntime | undefined;
    if (!s) return { trigger: false };
    if (!s.primed) { s.lastFire = ctx.timeSec; s.primed = true; }   // 起動時刻を基準にする
    const interval = Number(ctx.param("interval") ?? 0.5);
    const r = pulseStep(ctx.timeSec, s.lastFire, interval);
    s.lastFire = r.lastFire;
    return { trigger: r.fired };
  },
  disposeState: (_state: NodeState) => { /* no-op */ },
};
