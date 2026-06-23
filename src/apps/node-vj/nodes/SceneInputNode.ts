import type { NodeTypeDef } from "../graph/node-type";

/** #152: 別シーンの最終映像（Screen 出力 texture）を参照・出力する入力ノード。 */
export const SceneInputNode: NodeTypeDef = {
  type: "SceneInput",
  category: "input",
  description: "別のシーンの最終映像を texture として取り込むノード。シーン選択行で参照先を選ぶ（循環は禁止）。",
  isSink: false,
  sceneInput: true,
  inputs: [],
  outputs: [{ id: "texture", label: "tex", type: "texture", description: "参照先シーンの最終映像テクスチャ。" }],
  params: [
    { id: "sceneId", label: "scene", kind: "string", default: "", hidden: true,
      description: "参照先シーンの id（シーン選択行で設定・UI 非表示）。" },
  ],
  evaluate: (ctx) => {
    const sid = ctx.param("sceneId");
    if (typeof sid !== "string" || sid === "") return {};
    return { texture: ctx.env?.sceneTexture?.(sid) ?? undefined };
  },
};
