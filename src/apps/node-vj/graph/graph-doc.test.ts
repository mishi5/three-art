import { expect, test, describe } from "bun:test";
import {
  createGraph, addNode, removeNode, addConnection, removeConnection,
  wouldCreateCycle, type GraphDoc, type NodeInstance,
} from "./graph-doc";
import { NodeRegistry, type NodeTypeDef } from "./node-type";

// num1出力 / num1入力 / その他型を持つスタブノード種別。
function makeRegistry(): NodeRegistry {
  const r = new NodeRegistry();
  const def = (type: string): NodeTypeDef => ({
    type,
    inputs: [
      { id: "inN", label: "n", type: "number" },
      { id: "inP", label: "p", type: "pose" },
    ],
    outputs: [
      { id: "outN", label: "n", type: "number" },
      { id: "outA", label: "a", type: "audio" },
    ],
    params: [],
    evaluate: () => ({}),
  });
  r.register(def("A"));
  r.register(def("B"));
  r.register(def("C"));
  return r;
}

function node(id: string, type = "A"): NodeInstance {
  return { id, type, params: {} };
}

function g3(): GraphDoc {
  const g = createGraph();
  addNode(g, node("a"));
  addNode(g, node("b"));
  addNode(g, node("c"));
  return g;
}

const conn = (id: string, fn: string, fp: string, tn: string, tp: string) =>
  ({ id, from: { node: fn, port: fp }, to: { node: tn, port: tp } });

describe("graph-doc node ops", () => {
  test("addNode 重複 id は throw", () => {
    const g = createGraph();
    addNode(g, node("a"));
    expect(() => addNode(g, node("a"))).toThrow();
  });

  test("removeNode は関連コネクションも削除", () => {
    const g = g3();
    const r = makeRegistry();
    expect(addConnection(g, r, conn("e1", "a", "outN", "b", "inN")).ok).toBe(true);
    removeNode(g, "a");
    expect(g.nodes.find((n) => n.id === "a")).toBeUndefined();
    expect(g.connections.length).toBe(0);
  });
});

describe("addConnection 検査", () => {
  test("正常な number→number は ok", () => {
    const g = g3();
    const r = makeRegistry();
    expect(addConnection(g, r, conn("e1", "a", "outN", "b", "inN")).ok).toBe(true);
    expect(g.connections.length).toBe(1);
  });

  test("自己接続は拒否", () => {
    const g = g3();
    const r = makeRegistry();
    const res = addConnection(g, r, conn("e1", "a", "outN", "a", "inN"));
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("self-connection");
  });

  test("型不一致は拒否（audio→number）", () => {
    const g = g3();
    const r = makeRegistry();
    const res = addConnection(g, r, conn("e1", "a", "outA", "b", "inN"));
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("type mismatch");
  });

  test("入力ポート重複は拒否", () => {
    const g = g3();
    const r = makeRegistry();
    expect(addConnection(g, r, conn("e1", "a", "outN", "b", "inN")).ok).toBe(true);
    const res = addConnection(g, r, conn("e2", "c", "outN", "b", "inN"));
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("input already connected");
  });

  test("不在ポートは拒否", () => {
    const g = g3();
    const r = makeRegistry();
    const res = addConnection(g, r, conn("e1", "a", "nope", "b", "inN"));
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("port not found");
  });

  test("循環は拒否", () => {
    const g = g3();
    const r = makeRegistry();
    // a→b, b→c を張ってから c→a を試すと循環
    expect(addConnection(g, r, conn("e1", "a", "outN", "b", "inN")).ok).toBe(true);
    expect(addConnection(g, r, conn("e2", "b", "outN", "c", "inN")).ok).toBe(true);
    const res = addConnection(g, r, conn("e3", "c", "outN", "a", "inN"));
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("cycle");
  });
});

describe("wouldCreateCycle / removeConnection", () => {
  test("wouldCreateCycle", () => {
    const g = g3();
    const r = makeRegistry();
    addConnection(g, r, conn("e1", "a", "outN", "b", "inN"));
    expect(wouldCreateCycle(g, "b", "a")).toBe(true);
    expect(wouldCreateCycle(g, "b", "c")).toBe(false);
  });

  test("removeConnection", () => {
    const g = g3();
    const r = makeRegistry();
    addConnection(g, r, conn("e1", "a", "outN", "b", "inN"));
    removeConnection(g, "e1");
    expect(g.connections.length).toBe(0);
  });
});
