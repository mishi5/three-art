import { RainField } from "../../../core/visuals/rain";
import type { RainFieldUpdateParams } from "../../../core/visuals/params";
import type { AudioFeatures } from "../../../core/types";
import type { NodeState, NodeTypeDef } from "../graph/node-type";
import { VisualSurface } from "../graph/visual-surface";

interface RainState {
  rain: RainField;
  surface: VisualSurface;
}

/**
 * core の RainField を駆動する visual ノード。
 * #76: 専用シーン(VisualSurface)を自分の RT に描画し、結果を texture 出力で渡す。
 * number 入力 baseSpeed / count は未接続時 param 値にフォールバックする。
 */
export const RainVisualNode: NodeTypeDef = {
  type: "RainVisual",
  category: "visual",
  description: "音に反応する雨のような縦ストリームを描画する visual。結果を texture 出力する。",
  isSink: true,
  inputs: [
    { id: "audio", label: "audio", type: "audio", description: "雨の動きを駆動する音響特徴量入力（未接続なら環境の audio）。" },
    { id: "baseSpeed", label: "baseSpeed", type: "number", description: "落下速度の入力（未接続なら param 値）。" },
    { id: "count", label: "count", type: "number", description: "粒子数の入力（未接続なら param 値）。" },
  ],
  outputs: [{ id: "texture", label: "tex", type: "texture", description: "描画結果のテクスチャ。" }],
  params: [
    { id: "baseSpeed", label: "baseSpeed", kind: "number", default: 0.3, min: 0, max: 3, step: 0.01, description: "雨粒の基本落下速度。" },
    { id: "count", label: "count", kind: "int", default: 2000, min: 16, max: 8000, step: 1, description: "雨粒の本数。" },
    { id: "ampGain", label: "ampGain", kind: "number", default: 1.0, min: 0, max: 4, step: 0.1, description: "音量に対する反応の強さ。" },
    { id: "length", label: "length", kind: "number", default: 0.06, min: 0.01, max: 0.5, step: 0.01, description: "雨粒（ストリーク）の長さ。" },
    { id: "areaWidth", label: "areaWidth", kind: "number", default: 2.0, min: 0.5, max: 6, step: 0.1, description: "雨が降る領域の横幅（world m）。" },
    { id: "areaHeight", label: "areaHeight", kind: "number", default: 2.4, min: 0.5, max: 6, step: 0.1, description: "雨が降る領域の高さ（world m）。" },
  ],
  createState(): RainState {
    const rain = new RainField();
    const surface = new VisualSurface();
    surface.scene.add(rain.object3D);
    return { rain, surface };
  },
  disposeState(state: NodeState): void {
    (state as RainState).surface.dispose();
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
    const texture = state.surface.render(env.renderer, env.camera);
    return { texture };
  },
};
