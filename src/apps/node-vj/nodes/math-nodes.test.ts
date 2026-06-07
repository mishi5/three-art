import { expect, test, describe } from "bun:test";
import { evaluate } from "../graph/evaluator";
import { createGraph, addNode, addConnection } from "../graph/graph-doc";
import { NodeRegistry } from "../graph/node-type";
import { NumberNode } from "./NumberNode";
import { TimeNode } from "./TimeNode";
import { MultiplyNode } from "./MultiplyNode";

function registry(): NodeRegistry {
  const r = new NodeRegistry();
  r.register(NumberNode);
  r.register(TimeNode);
  r.register(MultiplyNode);
  return r;
}

describe("pure nodes", () => {
  test("Number は param value を出力", () => {
    const r = registry();
    const g = createGraph();
    addNode(g, { id: "n", type: "Number", params: { value: 2.5 } });
    const out = evaluate(g, r, { timeSec: 0 }).get("n");
    expect(out?.out).toBe(2.5);
  });

  test("Time は timeSec*scale を出力", () => {
    const r = registry();
    const g = createGraph();
    addNode(g, { id: "t", type: "Time", params: { scale: 2 } });
    const out = evaluate(g, r, { timeSec: 3 }).get("t");
    expect(out?.out).toBe(6);
  });

  test("Number→Multiply(×Number) のチェーン", () => {
    const r = registry();
    const g = createGraph();
    addNode(g, { id: "a", type: "Number", params: { value: 4 } });
    addNode(g, { id: "b", type: "Number", params: { value: 3 } });
    addNode(g, { id: "m", type: "Multiply", params: {} });
    addConnection(g, r, { id: "e1", from: { node: "a", port: "out" }, to: { node: "m", port: "a" } });
    addConnection(g, r, { id: "e2", from: { node: "b", port: "out" }, to: { node: "m", port: "b" } });
    const out = evaluate(g, r, { timeSec: 0 }).get("m");
    expect(out?.out).toBe(12);
  });

  test("Multiply 未接続入力は param フォールバック", () => {
    const r = registry();
    const g = createGraph();
    addNode(g, { id: "m", type: "Multiply", params: { a: 5, b: 2 } });
    const out = evaluate(g, r, { timeSec: 0 }).get("m");
    expect(out?.out).toBe(10);
  });
});
