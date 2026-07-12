import type { NodeTypeDef, ParamDef } from "../graph/node-type";
import { SCREEN_TEXTURE_KEY } from "../graph/texture-screen";
import { DEFAULT_CORNERS, WARP_MAX, WARP_MIN, WARP_PARAM_IDS, type WarpParamId } from "../warp-logic";

/** #282: 4 隅 param の default（tl=(0,0) tr=(1,0) bl=(0,1) br=(1,1)＝ワープなし）。 */
const CORNER_DEFAULTS: Record<WarpParamId, number> = {
  tlX: DEFAULT_CORNERS.tl.x, tlY: DEFAULT_CORNERS.tl.y,
  trX: DEFAULT_CORNERS.tr.x, trY: DEFAULT_CORNERS.tr.y,
  blX: DEFAULT_CORNERS.bl.x, blY: DEFAULT_CORNERS.bl.y,
  brX: DEFAULT_CORNERS.br.x, brY: DEFAULT_CORNERS.br.y,
};

/** #282: コーナーピンワープの 4 隅 param（noInput＝ポート化しない。手入力微調整用に可視）。 */
const warpParams: ParamDef[] = WARP_PARAM_IDS.map((id) => ({
  id,
  label: `${id.slice(0, 2)}.${id.slice(2).toLowerCase()}`, // 例: tlX → "tl.x"
  kind: "number",
  default: CORNER_DEFAULTS[id],
  min: WARP_MIN,
  max: WARP_MAX,
  step: 0.001,
  noInput: true,
  description: `node.Screen.param.${id}`,
}));

/**
 * 画面出力ノード（#76）。texture 入力を受け取り、画面に表示するテクスチャとして
 * 記録する。実際の canvas への転写は GraphRuntime が評価後にまとめて行う
 * （クリア順序を runtime に一元化するため、ここでは描画しない）。
 * #282: 「⧉ 出力」トグル（この Screen 専用の出力ウィンドウ）とコーナーピンワープの
 * 4 隅 param を持つ。ワープは専用出力ウィンドウ側の描画にのみ掛かり、メイン canvas への
 * 従来合成（pickScreenTextures）には影響しない。
 */
export const ScreenNode: NodeTypeDef = {
  type: "Screen",
  category: "output",
  description: "node.Screen.desc",
  isSink: true,
  screenOutput: true,
  inputs: [{ id: "texture", label: "tex", type: "texture", description: "node.Screen.port.texture" }],
  outputs: [],
  params: warpParams,
  evaluate(ctx) {
    const tex = ctx.input("texture");
    return tex ? { [SCREEN_TEXTURE_KEY]: tex } : {};
  },
};
