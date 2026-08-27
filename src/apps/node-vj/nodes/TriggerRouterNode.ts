// #272: TriggerRouter ノード。index（number）を受けて、対応する 1 本の trigger だけを発火させる
// 分配ノード（デマルチプレクサ）。MidiPad の index/trigger を受けてパッドごとに別の動作へ配線する、
// というのが主用途だが MIDI 専用ではなく、TapSequencer や BeatClock の出力の分配にも使える。
import type { NodeState, NodeTypeDef } from "../graph/node-type";
import { ROUTER_OUTPUTS, routeIndex } from "./midi-node-logic";

/** 出力ポート id（t1..t16）。 */
const OUT_IDS = Array.from({ length: ROUTER_OUTPUTS }, (_v, i) => `t${i + 1}`);

/** 全出力 false の戻り値（発火していない出力も未定義にせず false で揃える）。 */
function allFalse(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const id of OUT_IDS) out[id] = false;
  return out;
}

/**
 * #272: TriggerRouter の永続状態。
 * - `trig` 接続時: その立ち上がりで、そのフレームの index に対応する出力を 1 フレーム発火。
 * - `trig` 未接続時: index が変化した瞬間に発火（初回は基準合わせのみで暴発しない）。
 * trigger 入力は未接続だと undefined が返る（BeatClock の tap/onset と同じ）ので、
 * param を足さずに 2 モードを区別できる。
 */
export class TriggerRouterRuntime {
  private prevTrig = false;
  /** 直近の index（未評価は null）。trig 未接続モードの変化検出に使う。 */
  private prevIndex: number | null = null;

  /** 発火すべき出力番号（0 始まり）。何も発火しないなら null。 */
  step(index: unknown, trig: unknown, offset: number): number | null {
    const hasTrig = trig !== undefined;
    const idx = Number(index);
    const target = routeIndex(idx, offset, ROUTER_OUTPUTS);

    if (hasTrig) {
      const now = Boolean(trig);
      const rising = now && !this.prevTrig;
      this.prevTrig = now;
      this.prevIndex = Number.isFinite(idx) ? idx : null;
      return rising ? target : null;
    }

    // trig 未接続: index の変化をエッジとして使う。
    this.prevTrig = false;
    if (index === undefined || !Number.isFinite(idx)) {
      this.prevIndex = null;
      return null;
    }
    const changed = this.prevIndex !== null && this.prevIndex !== idx;
    this.prevIndex = idx;
    return changed ? target : null;
  }
}

/** #272: index を受けて対応する 1 本の trigger だけを発火させる分配ノード。 */
export const TriggerRouterNode: NodeTypeDef = {
  type: "TriggerRouter",
  category: "control",
  description: "node.TriggerRouter.desc",
  isSink: false,
  inputs: [
    { id: "index", label: "index", type: "number", description: "node.TriggerRouter.port.index" },
    { id: "trig", label: "trig", type: "trigger", description: "node.TriggerRouter.port.trig" },
  ],
  outputs: OUT_IDS.map((id) => ({
    id, label: id, type: "trigger" as const, description: "node.TriggerRouter.port.out",
  })),
  params: [
    // 17 個目以降を 2 台目のルータで受けるためのずらし幅（配線対象ではないので noInput）。
    { id: "offset", label: "offset", kind: "int", default: 0, min: -64, max: 64, step: 1,
      noInput: true, description: "node.TriggerRouter.param.offset" },
  ],
  createState: () => new TriggerRouterRuntime(),
  evaluate: (ctx) => {
    const out = allFalse();
    const s = ctx.state as TriggerRouterRuntime | undefined;
    if (!s) return out;
    const offset = Number(ctx.param("offset") ?? 0);
    const target = s.step(ctx.input("index"), ctx.input("trig"), offset);
    if (target !== null) out[OUT_IDS[target]!] = true;
    return out;
  },
  disposeState: (_state: NodeState) => { /* 確保資源なし */ },
};
