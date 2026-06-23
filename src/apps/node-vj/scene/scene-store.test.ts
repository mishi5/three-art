import { expect, test, describe } from "bun:test";
import { SceneStore, SCENE_SET_VERSION, type SceneSet } from "./scene-store";
import { memoryAdapter } from "../graph/graph-store";

function sampleSet(): SceneSet {
  return {
    version: SCENE_SET_VERSION,
    scenes: [{ id: "a", name: "Scene 1", graph: { version: 1, nodes: [], connections: [] } }],
    activeId: "a",
  };
}

describe("SceneStore", () => {
  test("save→load round-trip", () => {
    const s = new SceneStore(memoryAdapter());
    expect(s.load()).toBeNull();
    s.save(sampleSet());
    expect(s.load()).toEqual(sampleSet());
  });
  test("壊れた JSON は null", () => {
    const kv = memoryAdapter();
    kv.setItem("node-vj.scenes.v1", "{ not json");
    expect(new SceneStore(kv).load()).toBeNull();
  });
  test("version 不一致・空配列は null", () => {
    const kv = memoryAdapter();
    kv.setItem("node-vj.scenes.v1", JSON.stringify({ version: 99, scenes: [], activeId: "x" }));
    expect(new SceneStore(kv).load()).toBeNull();
  });
});
