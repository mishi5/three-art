import { expect, test, describe } from "bun:test";
import { sanitizeSceneSet } from "./scene-sanitize";
import { SCENE_SET_VERSION, type SceneSet } from "./scene-store";
import { createGraph, addNode, type GraphDoc } from "../graph/graph-doc";
import { createDefaultRegistry } from "../nodes/registry";

const r = createDefaultRegistry();

function graphWith(...nodes: { id: string; type: string; params?: Record<string, unknown> }[]): GraphDoc {
  const g = createGraph();
  for (const n of nodes) addNode(g, { id: n.id, type: n.type, params: n.params ?? {} });
  return g;
}

function set(scenes: SceneSet["scenes"], activeId: string, outputId?: string | null): SceneSet {
  return { version: SCENE_SET_VERSION, scenes, activeId, outputId };
}

describe("sanitizeSceneSet", () => {
  test("正常な SceneSet は warning なしでシーン構成が保たれる", () => {
    const input = set(
      [{ id: "a", name: "Scene 1", graph: graphWith({ id: "n", type: "Number", params: { value: 1 } }) }],
      "a",
    );
    const { set: out, warnings } = sanitizeSceneSet(input, r);
    expect(warnings).toEqual([]);
    expect(out?.scenes.map((s) => s.id)).toEqual(["a"]);
    expect(out?.scenes[0]!.graph.nodes.map((n) => n.id)).toEqual(["n"]);
    expect(out?.activeId).toBe("a");
  });

  test("未知ノード型は除去し warning を残す（正常ノードは保持）", () => {
    const g = graphWith({ id: "n", type: "Number", params: { value: 1 } });
    g.nodes.push({ id: "ghost", type: "NoSuchNode", params: {} });
    const input = set([{ id: "a", name: "Scene 1", graph: g }], "a");
    const { set: out, warnings } = sanitizeSceneSet(input, r);
    expect(out?.scenes[0]!.graph.nodes.find((n) => n.id === "ghost")).toBeUndefined();
    expect(out?.scenes[0]!.graph.nodes.find((n) => n.id === "n")).toBeDefined();
    expect(warnings.some((w) => w.includes("ghost"))).toBe(true);
  });

  test("未知ノードへの接続も一緒に消える", () => {
    const g = graphWith({ id: "n", type: "Number", params: { value: 1 } });
    g.nodes.push({ id: "ghost", type: "NoSuchNode", params: {} });
    g.connections.push({ id: "cg", from: { node: "n", port: "out" }, to: { node: "ghost", port: "x" } });
    const input = set([{ id: "a", name: "S", graph: g }], "a");
    const { set: out } = sanitizeSceneSet(input, r);
    expect(out?.scenes[0]!.graph.connections.find((c) => c.id === "cg")).toBeUndefined();
  });

  test("id が不正なシーンは捨てる", () => {
    const input = set(
      [
        { id: "", name: "bad", graph: createGraph() } as unknown as SceneSet["scenes"][number],
        { id: "a", name: "ok", graph: createGraph() },
      ],
      "a",
    );
    const { set: out, warnings } = sanitizeSceneSet(input, r);
    expect(out?.scenes.map((s) => s.id)).toEqual(["a"]);
    expect(warnings.some((w) => w.includes("id が不正"))).toBe(true);
  });

  test("graph が壊れている（version 不一致）シーンは空グラフで再生成", () => {
    const broken = { version: 999, nodes: [], connections: [] } as unknown as GraphDoc;
    const input = set([{ id: "a", name: "S", graph: broken }], "a");
    const { set: out, warnings } = sanitizeSceneSet(input, r);
    expect(out?.scenes[0]!.graph.nodes).toEqual([]);
    expect(out?.scenes[0]!.graph.version).toBe(createGraph().version);
    expect(warnings.some((w) => w.includes("初期化"))).toBe(true);
  });

  test("activeId が生存シーンに無ければ先頭へフォールバックし warning", () => {
    const input = set([{ id: "a", name: "S", graph: createGraph() }], "missing");
    const { set: out, warnings } = sanitizeSceneSet(input, r);
    expect(out?.activeId).toBe("a");
    expect(warnings.some((w) => w.includes("activeId"))).toBe(true);
  });

  test("outputId が生存シーンに無ければ null（追従）", () => {
    const input = set([{ id: "a", name: "S", graph: createGraph() }], "a", "gone");
    const { set: out } = sanitizeSceneSet(input, r);
    expect(out?.outputId).toBeNull();
  });

  test("outputId が生存していれば維持", () => {
    const input = set(
      [
        { id: "a", name: "S1", graph: createGraph() },
        { id: "b", name: "S2", graph: createGraph() },
      ],
      "a",
      "b",
    );
    const { set: out } = sanitizeSceneSet(input, r);
    expect(out?.outputId).toBe("b");
  });

  test("有効シーンが 0 になったら set=null", () => {
    const input = set(
      [{ id: "", name: "bad", graph: createGraph() } as unknown as SceneSet["scenes"][number]],
      "x",
    );
    const { set: out, warnings } = sanitizeSceneSet(input, r);
    expect(out).toBeNull();
    expect(warnings.some((w) => w.includes("有効なシーン"))).toBe(true);
  });
});
