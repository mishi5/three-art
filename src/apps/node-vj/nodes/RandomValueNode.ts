import type { NodeState, NodeTypeDef } from "../graph/node-type";
import { rerollDue, randomRange } from "./param-gen-logic";

/** RandomValue のフレーム間状態。value=現在値, lastFire=最後に再ロールした時刻, prevTrig=エッジ検出用。 */
export class RandomValueRuntime {
  value = 0;
  lastFire = 0;
  prevTrig = false;
  primed = false;
}

/**
 * ランダム値を出力するジェネレータ（#155）。trigger の立ち上がり、または interval（秒, 0=自動なし）
 * の経過で min〜max のランダム値に再ロールする。Pulse の trigger と組み合わせて拍で再ロールできる。
 */
export const RandomValueNode: NodeTypeDef = {
  type: "RandomValue",
  category: "generator",
  description: "min〜max のランダム値を出力。trigger の立ち上がり、または interval 秒ごとに再ロールする。",
  inputs: [{ id: "trigger", label: "trig", type: "trigger", description: "立ち上がりで値を再ロールする trigger（任意）。" }],
  outputs: [{ id: "out", label: "n", type: "number", description: "現在のランダム値。" }],
  params: [
    { id: "min", label: "min", kind: "number", default: 0, step: 0.1, description: "ランダム値の下限。" },
    { id: "max", label: "max", kind: "number", default: 1, step: 0.1, description: "ランダム値の上限。" },
    { id: "interval", label: "interval", kind: "number", default: 0, min: 0, max: 10, step: 0.01, description: "自動再ロール間隔（秒）。0 で自動なし（trigger のみ）。" },
  ],
  createState: () => new RandomValueRuntime(),
  evaluate: (ctx) => {
    const s = ctx.state as RandomValueRuntime | undefined;
    if (!s) return { out: 0 };
    const min = Number(ctx.param("min") ?? 0);
    const max = Number(ctx.param("max") ?? 1);
    const interval = Number(ctx.param("interval") ?? 0);
    const trig = Boolean(ctx.input("trigger"));
    const edge = trig && !s.prevTrig;
    s.prevTrig = trig;
    if (!s.primed) { s.value = randomRange(min, max, Math.random()); s.lastFire = ctx.timeSec; s.primed = true; }
    if (edge || rerollDue(ctx.timeSec, s.lastFire, interval)) {
      s.value = randomRange(min, max, Math.random());
      s.lastFire = ctx.timeSec;
    }
    return { out: s.value };
  },
  disposeState: (_state: NodeState) => { /* no-op */ },
};
