import { expect, test, describe } from "bun:test";
import { collectSceneRefs, wouldCreateSceneCycle, sceneRenderOrder } from "./scene-refs";
import { createDefaultRegistry } from "../nodes/registry";
import { createGraph, addNode, type GraphDoc } from "../graph/graph-doc";

const reg = createDefaultRegistry();
function sceneGraph(refs: string[]): GraphDoc {
  const g = createGraph();
  refs.forEach((sid, i) => addNode(g, { id: `si${i}`, type: "SceneInput", params: { sceneId: sid } }));
  return g;
}

describe("collectSceneRefs", () => {
  test("SceneInput の非空 sceneId を集める", () => {
    const g = sceneGraph(["B", "", "C"]);
    expect(collectSceneRefs(g, reg).sort()).toEqual(["B", "C"]);
  });
});

describe("wouldCreateSceneCycle", () => {
  test("自己参照は true", () => {
    const scenes = [{ id: "A", graph: createGraph() }];
    expect(wouldCreateSceneCycle(scenes, reg, "A", "A")).toBe(true);
  });
  test("直接循環 A→B 既存で B→A 追加は true", () => {
    const scenes = [
      { id: "A", graph: sceneGraph(["B"]) },
      { id: "B", graph: createGraph() },
    ];
    expect(wouldCreateSceneCycle(scenes, reg, "B", "A")).toBe(true);
  });
  test("間接循環 A→B→C 既存で C→A 追加は true", () => {
    const scenes = [
      { id: "A", graph: sceneGraph(["B"]) },
      { id: "B", graph: sceneGraph(["C"]) },
      { id: "C", graph: createGraph() },
    ];
    expect(wouldCreateSceneCycle(scenes, reg, "C", "A")).toBe(true);
  });
  test("循環しない追加は false", () => {
    const scenes = [
      { id: "A", graph: sceneGraph(["B"]) },
      { id: "B", graph: createGraph() },
      { id: "C", graph: createGraph() },
    ];
    expect(wouldCreateSceneCycle(scenes, reg, "A", "C")).toBe(false);
  });
});

describe("sceneRenderOrder", () => {
  test("到達する参照先を依存順（leaf 先）で返す（active 自身は除外）", () => {
    const scenes = [
      { id: "A", graph: sceneGraph(["B"]) },
      { id: "B", graph: sceneGraph(["C"]) },
      { id: "C", graph: createGraph() },
      { id: "D", graph: createGraph() },
    ];
    expect(sceneRenderOrder("A", scenes, reg)).toEqual(["C", "B"]);
  });
  test("循環があっても有限で返る（保険）", () => {
    const scenes = [
      { id: "A", graph: sceneGraph(["B"]) },
      { id: "B", graph: sceneGraph(["A"]) },
    ];
    expect(sceneRenderOrder("A", scenes, reg)).toContain("B");
  });
});
