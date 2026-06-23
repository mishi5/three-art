import { expect, test, describe } from "bun:test";
import { SceneManager, singleSceneSet } from "./scene-manager";
import { SceneStore } from "./scene-store";
import { memoryAdapter } from "../graph/graph-store";
import { createGraph, addNode } from "../graph/graph-doc";

function mgr() {
  let n = 0;
  const store = new SceneStore(memoryAdapter());
  const g = createGraph();
  addNode(g, { id: "x", type: "Number", params: { value: 1 } });
  const m = new SceneManager({ store, genId: () => `s${++n}` }, singleSceneSet(g, "s0", "Scene 1"));
  return { m, store };
}

describe("SceneManager", () => {
  test("初期は 1 シーン・active", () => {
    const { m } = mgr();
    expect(m.list().length).toBe(1);
    expect(m.activeId()).toBe("s0");
    expect(m.active().name).toBe("Scene 1");
  });
  test("add で末尾に空シーン追加・active 移動・永続化", () => {
    const { m, store } = mgr();
    const s = m.add();
    expect(m.list().length).toBe(2);
    expect(m.activeId()).toBe(s.id);
    expect(s.graph.nodes.length).toBe(0);
    expect(store.load()?.scenes.length).toBe(2);
  });
  test("duplicate は graph を独立コピー（元を変更しても複製は不変）", () => {
    const { m } = mgr();
    const dup = m.duplicate("s0");
    expect(m.list().length).toBe(2);
    addNode(m.list()[0]!.graph, { id: "y", type: "Number", params: { value: 2 } });
    expect(dup.graph.nodes.map((n) => n.id)).toEqual(["x"]);
  });
  test("remove: 最後の 1 つは消えない", () => {
    const { m } = mgr();
    m.remove("s0");
    expect(m.list().length).toBe(1);
  });
  test("remove: active を消すと隣を active に", () => {
    const { m } = mgr();
    const s = m.add();          // [s0, s]、active = s.id
    m.setActive("s0");
    m.remove("s0");
    expect(m.activeId()).toBe(s.id);
    expect(m.list().length).toBe(1);
  });
  test("persist で現在の集合を保存する（初期化直後の保存用）", () => {
    const { m, store } = mgr();
    expect(store.load()).toBeNull(); // 構築だけでは未保存
    m.persist();
    expect(store.load()?.scenes.length).toBe(1);
    expect(store.load()?.activeId).toBe("s0");
  });
  test("rename / updateActiveGraph / onChange / 永続化", () => {
    const { m, store } = mgr();
    let fired = 0;
    const off = m.onChange(() => { fired++; });
    m.rename("s0", "Intro");
    expect(m.active().name).toBe("Intro");
    const g = createGraph();
    addNode(g, { id: "z", type: "Number", params: { value: 9 } });
    m.updateActiveGraph(g);
    expect(m.active().graph.nodes.map((n) => n.id)).toEqual(["z"]);
    addNode(g, { id: "w", type: "Number", params: { value: 0 } });
    expect(m.active().graph.nodes.map((n) => n.id)).toEqual(["z"]); // 書き戻しは独立コピー
    expect(fired).toBeGreaterThanOrEqual(2);
    off();
    const before = fired;
    m.rename("s0", "X");
    expect(fired).toBe(before); // 解除後は増えない
    expect(store.load()?.scenes[0]!.name).toBe("X");
  });
});
