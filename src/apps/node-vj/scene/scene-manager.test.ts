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
  // #174: 出力シーン id
  test("outputId 既定は null（編集に追従）", () => {
    const { m } = mgr();
    expect(m.outputId()).toBeNull();
  });
  test("setOutput でピン留め・永続化・onChange 通知", () => {
    const { m, store } = mgr();
    const s = m.add();
    let fired = 0;
    m.onChange(() => { fired++; });
    m.setOutput(s.id);
    expect(m.outputId()).toBe(s.id);
    expect(store.load()?.outputId).toBe(s.id);
    expect(fired).toBe(1);
  });
  test("setOutput(null) で追従へ戻す", () => {
    const { m } = mgr();
    const s = m.add();
    m.setOutput(s.id);
    m.setOutput(null);
    expect(m.outputId()).toBeNull();
  });
  test("出力先シーンを削除すると追従（null）に戻る", () => {
    const { m } = mgr();
    const s = m.add();          // [s0, s]、active=s
    m.setActive("s0");
    m.setOutput(s.id);          // 出力を s にピン
    m.remove(s.id);
    expect(m.outputId()).toBeNull();
  });
  test("初期 SceneSet の outputId を引き継ぐ", () => {
    const store = new SceneStore(memoryAdapter());
    const set = { ...singleSceneSet(createGraph(), "s0", "Scene 1"), outputId: "s0" };
    const m = new SceneManager({ store }, set);
    expect(m.outputId()).toBe("s0");
  });

  // #201 全シーン差し替え（プロジェクト読込）
  test("replaceAll で全シーン・activeId・outputId を差し替え・永続化・通知", () => {
    const { m, store } = mgr();
    let fired = 0;
    m.onChange(() => { fired++; });
    const set = {
      version: 1,
      scenes: [
        { id: "p1", name: "P1", graph: createGraph() },
        { id: "p2", name: "P2", graph: createGraph() },
      ],
      activeId: "p2",
      outputId: "p1",
    };
    m.replaceAll(set);
    expect(m.list().map((s) => s.id)).toEqual(["p1", "p2"]);
    expect(m.activeId()).toBe("p2");
    expect(m.outputId()).toBe("p1");
    expect(store.load()?.scenes.length).toBe(2);
    expect(fired).toBe(1);
  });
  test("replaceAll: activeId 不正は先頭へ・outputId 不正は null", () => {
    const { m } = mgr();
    m.replaceAll({ version: 1, scenes: [{ id: "p1", name: "P1", graph: createGraph() }], activeId: "x", outputId: "y" });
    expect(m.activeId()).toBe("p1");
    expect(m.outputId()).toBeNull();
  });
  test("replaceAll: 空 scenes は throw", () => {
    const { m } = mgr();
    expect(() => m.replaceAll({ version: 1, scenes: [], activeId: "x" })).toThrow();
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
