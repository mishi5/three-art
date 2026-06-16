import type { NodeState, NodeTypeDef } from "../graph/node-type";

/**
 * AD エンベロープの値（純関数）。発火からの経過秒 elapsed に対し:
 * - elapsed<0 → 0
 * - attack 中（attack>0 かつ elapsed<attack）→ 線形 0→1
 * - release 中 → 線形 1→0
 * - 以降 → 0
 * attack=0 は発火直後に 1。attack=release=0 は 0。
 */
export function envelopeValue(elapsed: number, attack: number, release: number): number {
  if (elapsed < 0) return 0;
  if (attack > 0 && elapsed < attack) return elapsed / attack;
  const d = elapsed - attack;
  if (d < release) return release > 0 ? 1 - d / release : 0;
  return 0;
}

/** Envelope のフレーム間状態。triggerTime は直近の立ち上がり時刻。 */
export class EnvelopeRuntime {
  triggerTime = -Infinity;
  prevTrigger = false;
}

/** trigger を受け、発火で立ち上がり時間で減衰する number を出力する（#110）。 */
export const EnvelopeNode: NodeTypeDef = {
  type: "Envelope",
  category: "process",
  inputs: [{ id: "trigger", label: "trig", type: "trigger" }],
  outputs: [{ id: "out", label: "out", type: "number" }],
  params: [
    { id: "attack", label: "attack", kind: "number", default: 0.01, min: 0, max: 2, step: 0.01 },
    { id: "release", label: "release", kind: "number", default: 0.3, min: 0, max: 5, step: 0.01 },
  ],
  createState: () => new EnvelopeRuntime(),
  evaluate: (ctx) => {
    const s = ctx.state as EnvelopeRuntime | undefined;
    if (!s) return { out: 0 };
    const fired = Boolean(ctx.input("trigger"));
    if (fired && !s.prevTrigger) s.triggerTime = ctx.timeSec;  // 立ち上がりエッジで再トリガー
    s.prevTrigger = fired;
    const attack = Math.max(0, Number(ctx.param("attack") ?? 0.01));
    const release = Math.max(0, Number(ctx.param("release") ?? 0.3));
    return { out: envelopeValue(ctx.timeSec - s.triggerTime, attack, release) };
  },
};
