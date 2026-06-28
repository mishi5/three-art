// #201 プロジェクト（全シーン状態）の保存/読込 純ロジックのテスト。
import { expect, test, describe } from "bun:test";
import {
  serializeProject, deserializeProject, projectFileName, PROJECT_VERSION,
} from "./project-file";
import { SCENE_SET_VERSION, type SceneSet } from "./scene-store";
import { createGraph, addNode, addConnection, createGroup, addLabel } from "../graph/graph-doc";
import { createDefaultRegistry } from "../nodes/registry";

const r = createDefaultRegistry();

/** ノード配置・接続・groups・labels を含む 2 シーンの SceneSet を作る。 */
function sampleSet(): SceneSet {
  // round-trip 一致のため param は def の全キーを埋める（deserialize が default 補完するため）。
  const g1 = createGraph();
  addNode(g1, { id: "n1", type: "Number", params: { value: 2.5, min: 0, max: 1 }, position: { x: 10, y: 20 }, name: "速度" });
  addNode(g1, { id: "m", type: "Multiply", params: { a: 1, b: 3 }, position: { x: 200, y: 50 } });
  addConnection(g1, r, { id: "c1", from: { node: "n1", port: "out" }, to: { node: "m", port: "a" } });
  createGroup(g1, "grp", ["n1", "m"], "Pair");
  addLabel(g1, { id: "L1", x: 5, y: 6, text: "メモ" });

  const g2 = createGraph();
  addNode(g2, { id: "rv", type: "RainVisual", params: { baseSpeed: 0.7, count: 2000, ampGain: 1, length: 0.06, areaWidth: 2, areaHeight: 2.4 }, position: { x: 40, y: 30 } });
  addNode(g2, { id: "sc", type: "Screen", params: {}, position: { x: 300, y: 30 } });
  addConnection(g2, r, { id: "c2", from: { node: "rv", port: "texture" }, to: { node: "sc", port: "texture" } });

  return {
    version: SCENE_SET_VERSION,
    scenes: [
      { id: "s1", name: "Scene 1", graph: g1 },
      { id: "s2", name: "Scene 2", graph: g2 },
    ],
    activeId: "s2",
    outputId: "s1",
  };
}

describe("serializeProject / deserializeProject", () => {
  test("複数シーンを round-trip で同値（warnings なし）", () => {
    const set = sampleSet();
    const text = serializeProject(set);
    const { project, warnings } = deserializeProject(text, r);
    expect(warnings).toEqual([]);
    expect(project).toEqual(set);
  });

  test("YAML として妥当・version を含む", () => {
    const text = serializeProject(sampleSet());
    expect(text).toContain(`version: ${PROJECT_VERSION}`);
    expect(text).toContain("name: Scene 1");
    expect(text).toContain("type: RainVisual");
  });

  test("outputId null（追従）も round-trip", () => {
    const set = sampleSet();
    set.outputId = null;
    const { project } = deserializeProject(serializeProject(set), r);
    expect(project.outputId).toBeNull();
  });

  test("outputId 未指定（undefined）は null に正規化", () => {
    const set = sampleSet();
    delete set.outputId;
    const { project } = deserializeProject(serializeProject(set), r);
    expect(project.outputId).toBeNull();
  });

  test("未知ノード・不正接続を含むシーンは warning しつつ他シーンは復元", () => {
    const set = sampleSet();
    // s1 に未知ノードと、それへ向かう接続を混ぜる
    set.scenes[0]!.graph.nodes.push({ id: "ghost", type: "NoSuchNode", params: {} });
    set.scenes[0]!.graph.connections.push({ id: "cg", from: { node: "n1", port: "out" }, to: { node: "ghost", port: "x" } });
    const { project, warnings } = deserializeProject(serializeProject(set), r);
    const s1 = project.scenes.find((s) => s.id === "s1")!;
    expect(s1.graph.nodes.find((n) => n.id === "ghost")).toBeUndefined();
    expect(warnings.length).toBeGreaterThanOrEqual(1);
    // 他シーンは無傷
    expect(project.scenes.find((s) => s.id === "s2")!.graph.nodes.map((n) => n.id)).toEqual(["rv", "sc"]);
  });

  test("activeId が scenes に無ければ先頭へフォールバックし warning", () => {
    const set = sampleSet();
    set.activeId = "missing";
    const { project, warnings } = deserializeProject(serializeProject(set), r);
    expect(project.activeId).toBe("s1");
    expect(warnings.some((w) => w.includes("activeId"))).toBe(true);
  });

  test("outputId が scenes に無ければ null", () => {
    const set = sampleSet();
    set.outputId = "missing";
    const { project } = deserializeProject(serializeProject(set), r);
    expect(project.outputId).toBeNull();
  });

  test("シーン個別の graph が壊れていても空グラフで再生成し warning（他は無傷）", () => {
    const set = sampleSet();
    // graph version を壊す（deserializeGraph が throw する）
    (set.scenes[0]!.graph as { version: number }).version = 99;
    const { project, warnings } = deserializeProject(serializeProject(set), r);
    const s1 = project.scenes.find((s) => s.id === "s1")!;
    expect(s1.graph.nodes).toEqual([]);
    expect(warnings.some((w) => w.includes("s1"))).toBe(true);
    expect(project.scenes.find((s) => s.id === "s2")!.graph.nodes.length).toBe(2);
  });

  test("version 不一致は throw", () => {
    const text = serializeProject(sampleSet()).replace(`version: ${PROJECT_VERSION}`, "version: 99");
    expect(() => deserializeProject(text, r)).toThrow();
  });

  test("壊れた YAML / ルート非オブジェクトは throw", () => {
    expect(() => deserializeProject(": :: not yaml", r)).toThrow();
    expect(() => deserializeProject("42", r)).toThrow();
    expect(() => deserializeProject("- 1\n- 2", r)).toThrow();
  });

  test("scenes 欠落・空配列は throw", () => {
    expect(() => deserializeProject(`version: ${PROJECT_VERSION}\nactiveId: x`, r)).toThrow();
    expect(() => deserializeProject(`version: ${PROJECT_VERSION}\nactiveId: x\nscenes: []`, r)).toThrow();
  });
});

describe("projectFileName", () => {
  test("node-vj-project-YYYYMMDD-HHMMSS.yaml 形式", () => {
    const name = projectFileName(new Date(2026, 5, 29, 9, 8, 7));
    expect(name).toBe("node-vj-project-20260629-090807.yaml");
  });
});
