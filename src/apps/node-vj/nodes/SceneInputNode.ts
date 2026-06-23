import type { NodeTypeDef } from "../graph/node-type";
import { SIGNAL_OUTPUT, signalOutput } from "../graph/audio-signal";

/** #152/#172: 別シーンの最終映像（texture）と音声（audio）を参照・出力する入力ノード。 */
export const SceneInputNode: NodeTypeDef = {
  type: "SceneInput",
  category: "input",
  description: "別のシーンの最終映像 texture と音声 audio を取り込むノード。シーン選択行で参照先を選ぶ（循環は禁止）。",
  isSink: false,
  sceneInput: true,
  inputs: [],
  outputs: [
    { id: "texture", label: "tex", type: "texture", description: "参照先シーンの最終映像テクスチャ。" },
    SIGNAL_OUTPUT, // #172: 参照先シーンの音声（AudioOutput の出力）。親の AudioMix/AudioOutput へ繋ぐ。
  ],
  params: [
    { id: "sceneId", label: "scene", kind: "string", default: "", hidden: true,
      description: "参照先シーンの id（シーン選択行で設定・UI 非表示）。" },
  ],
  evaluate: (ctx) => {
    const sid = ctx.param("sceneId");
    if (typeof sid !== "string" || sid === "") return {};
    const texture = ctx.env?.sceneTexture?.(sid) ?? undefined;
    const audioNode = ctx.env?.sceneAudio?.(sid) ?? null;
    return { texture, ...signalOutput(audioNode) };
  },
};
