import { RainField } from "../../../core/visuals/rain";
import type { RainFieldUpdateParams } from "../../../core/visuals/params";
import type { AudioFeatures } from "../../../core/types";
import type { NodeEnv, NodeState, NodeTypeDef } from "../graph/node-type";

interface RainState {
  rain: RainField;
}

/**
 * core の RainField を駆動する visual sink ノード。
 * number 入力 baseSpeed / count は未接続時 param 値にフォールバックする。
 * 残りの rain パラメータは param として持つ（Settings 非依存）。
 */
export const RainVisualNode: NodeTypeDef = {
  type: "RainVisual",
  category: "visual",
  isSink: true,
  inputs: [
    { id: "audio", label: "audio", type: "audio" },
    { id: "baseSpeed", label: "baseSpeed", type: "number" },
    { id: "count", label: "count", type: "number" },
  ],
  outputs: [],
  params: [
    { id: "baseSpeed", label: "baseSpeed", kind: "number", default: 0.3, min: 0, max: 3, step: 0.01 },
    { id: "count", label: "count", kind: "int", default: 2000, min: 16, max: 8000, step: 1 },
    { id: "ampGain", label: "ampGain", kind: "number", default: 1.0, min: 0, max: 4, step: 0.1 },
    { id: "length", label: "length", kind: "number", default: 0.06, min: 0.01, max: 0.5, step: 0.01 },
    { id: "areaWidth", label: "areaWidth", kind: "number", default: 2.0, min: 0.5, max: 6, step: 0.1 },
    { id: "areaHeight", label: "areaHeight", kind: "number", default: 2.4, min: 0.5, max: 6, step: 0.1 },
  ],
  createState(env: NodeEnv): RainState {
    const rain = new RainField();
    env.scene.add(rain.object3D);
    return { rain };
  },
  disposeState(state: NodeState, env: NodeEnv): void {
    const s = state as RainState;
    env.scene.remove(s.rain.object3D);
  },
  evaluate(ctx) {
    const state = ctx.state as RainState | undefined;
    const env = ctx.env;
    if (!state || !env) return {};
    const params: RainFieldUpdateParams = {
      mode: "rain",
      rain: {
        baseSpeed: ctx.input("baseSpeed") as number,
        count: Math.floor(ctx.input("count") as number),
        ampGain: ctx.param("ampGain") as number,
        length: ctx.param("length") as number,
        areaWidth: ctx.param("areaWidth") as number,
        areaHeight: ctx.param("areaHeight") as number,
        binMapping: "log",
      },
    };
    // audio 入力ポートが接続されていればそれを、なければ env.audio をフォールバック。
    const audio = (ctx.input("audio") as AudioFeatures | undefined) ?? env.audio;
    state.rain.update(audio, params, ctx.timeSec);
    return {};
  },
};
