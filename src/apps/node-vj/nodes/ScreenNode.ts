import type { NodeTypeDef } from "../graph/node-type";
import { SCREEN_TEXTURE_KEY } from "../graph/texture-screen";

/**
 * 画面出力ノード（#76）。texture 入力を受け取り、画面に表示するテクスチャとして
 * 記録する。実際の canvas への転写は GraphRuntime が評価後にまとめて行う
 * （クリア順序を runtime に一元化するため、ここでは描画しない）。
 */
export const ScreenNode: NodeTypeDef = {
  type: "Screen",
  category: "output",
  description: "入力 texture を最終出力（画面）に表示する終端ノード。グラフの出口に置く。",
  isSink: true,
  inputs: [{ id: "texture", label: "tex", type: "texture", description: "画面に表示するテクスチャ。" }],
  outputs: [],
  params: [],
  evaluate(ctx) {
    const tex = ctx.input("texture");
    return tex ? { [SCREEN_TEXTURE_KEY]: tex } : {};
  },
};
