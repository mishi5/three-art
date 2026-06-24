import { expect, test, describe } from "bun:test";
import {
  createGraph, addNode, removeNode, replaceGraph,
  createGroup, removeGroup, groupOfNode,
} from "./graph-doc";

function g3() {
  const g = createGraph();
  addNode(g, { id: "a", type: "Number", params: {} });
  addNode(g, { id: "b", type: "Number", params: {} });
  addNode(g, { id: "c", type: "Number", params: {} });
  return g;
}

describe("node group", () => {
  test("createGroup: 2 件以上で作成、groupOfNode で引ける", () => {
    const g = g3();
    createGroup(g, "g1", ["a", "b"], "Intro");
    expect(g.groups?.length).toBe(1);
    expect(groupOfNode(g, "a")?.id).toBe("g1");
    expect(groupOfNode(g, "c")).toBeUndefined();
    expect(g.groups![0]!.name).toBe("Intro");
  });
  test("createGroup: 2 未満は作らない", () => {
    const g = g3();
    createGroup(g, "g1", ["a"]);
    expect(g.groups ?? []).toEqual([]);
  });
  test("createGroup: 重複所属しない（既存グループから移動）", () => {
    const g = g3();
    createGroup(g, "g1", ["a", "b"]);
    createGroup(g, "g2", ["b", "c"]);
    expect(groupOfNode(g, "b")?.id).toBe("g2");
    // g1 は b を失い a だけ→2 未満で解散
    expect(g.groups!.some((gr) => gr.id === "g1")).toBe(false);
    expect(groupOfNode(g, "a")).toBeUndefined();
  });
  test("removeGroup", () => {
    const g = g3();
    createGroup(g, "g1", ["a", "b"]);
    removeGroup(g, "g1");
    expect(g.groups ?? []).toEqual([]);
    expect(groupOfNode(g, "a")).toBeUndefined();
  });
  test("removeNode: グループから除去し 2 未満は解散", () => {
    const g = g3();
    createGroup(g, "g1", ["a", "b", "c"]);
    removeNode(g, "c");
    expect(groupOfNode(g, "a")?.nodeIds.sort()).toEqual(["a", "b"]);
    removeNode(g, "b");
    expect(g.groups ?? []).toEqual([]); // a だけ→解散
  });
  test("replaceGraph: groups もコピー", () => {
    const g = g3();
    createGroup(g, "g1", ["a", "b"]);
    const target = createGraph();
    replaceGraph(target, g);
    expect(target.groups?.[0]?.id).toBe("g1");
  });
});
