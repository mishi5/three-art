import { expect, test, describe } from "bun:test";
import { SceneInputNode } from "./SceneInputNode";
import type { EvalContext } from "../graph/node-type";

function ctx(sceneId: string, tex: unknown): EvalContext {
  return {
    timeSec: 0,
    input: () => undefined,
    param: (id) => (id === "sceneId" ? sceneId : undefined),
    node: { id: "n", type: "SceneInput", params: { sceneId } },
    env: {
      audio: {} as never, renderer: {} as never, camera: {} as never, audioContext: {} as never,
      sceneTexture: (id) => (id === sceneId ? tex : null),
    },
  };
}

describe("SceneInputNode", () => {
  test("texture 出力・sceneInput フラグ・sceneId は hidden", () => {
    expect(SceneInputNode.type).toBe("SceneInput");
    expect(SceneInputNode.sceneInput).toBe(true);
    expect(SceneInputNode.outputs.map((p) => p.id)).toEqual(["texture", "audio"]);
    expect(SceneInputNode.params.find((p) => p.id === "sceneId")?.hidden).toBe(true);
  });
  test("evaluate は env.sceneTexture(sceneId) を texture に返す", () => {
    const fake = {};
    expect(SceneInputNode.evaluate(ctx("B", fake)).texture).toBe(fake);
    expect(SceneInputNode.evaluate(ctx("", fake)).texture).toBeUndefined();
  });
  test("#172 evaluate は env.sceneAudio を audio(AudioSignal) で返す", () => {
    const fakeNode = {} as AudioNode;
    const c = {
      timeSec: 0, input: () => undefined,
      param: (id: string) => (id === "sceneId" ? "B" : undefined),
      node: { id: "n", type: "SceneInput", params: { sceneId: "B" } },
      env: { sceneTexture: () => null, sceneAudio: (id: string) => (id === "B" ? fakeNode : null) },
    } as never;
    const out = SceneInputNode.evaluate(c);
    expect((out.audio as { node: AudioNode }).node).toBe(fakeNode);
  });
});
