import { expect, test, describe } from "bun:test";
import { duplicateNodes } from "./duplicate";
import { createGraph, addNode, type GraphDoc } from "./graph-doc";

// 決定的な id 生成（テスト用）
function makeGenId(): (prefix: string) => string {
  let i = 0;
  return (prefix) => `${prefix}dup${++i}`;
}

/** a → b → c（b,c を選択して複製する想定のグラフ）。 */
function sample(): GraphDoc {
  const g = createGraph();
  addNode(g, { id: "a", type: "Number", params: { value: 5 }, position: { x: 0, y: 0 } });
  addNode(g, { id: "b", type: "Multiply", params: { a: 1, b: 2 }, position: { x: 200, y: 0 }, preview: true });
  addNode(g, { id: "c", type: "RainVisual", params: { baseSpeed: 0.5 }, position: { x: 400, y: 0 } });
  g.connections.push(
    { id: "e1", from: { node: "a", port: "out" }, to: { node: "b", port: "a" } },   // 外→内
    { id: "e2", from: { node: "b", port: "out" }, to: { node: "c", port: "baseSpeed" } }, // 内→内
  );
  return g;
}

describe("duplicateNodes", () => {
  test("種別・param・preview を引き継ぎ、+offset 位置に新 id で複製", () => {
    const g = sample();
    const ids = duplicateNodes(g, new Set(["b"]), makeGenId(), 24);
    expect(ids.length).toBe(1);
    const clone = g.nodes.find((n) => n.id === ids[0])!;
    expect(clone.type).toBe("Multiply");
    expect(clone.params).toEqual({ a: 1, b: 2 });
    expect(clone.params).not.toBe(g.nodes.find((n) => n.id === "b")!.params); // 深いコピー
    expect(clone.position).toEqual({ x: 224, y: 24 });
    expect(clone.preview).toBe(true);
  });

  test("選択内→選択内のエッジは複製ノード間に張り直す", () => {
    const g = sample();
    const ids = duplicateNodes(g, new Set(["b", "c"]), makeGenId(), 24);
    const [b2, c2] = ids;
    const internal = g.connections.find((c) => c.from.node === b2 && c.to.node === c2);
    expect(internal).toBeDefined();
    expect(internal!.from.port).toBe("out");
    expect(internal!.to.port).toBe("baseSpeed");
  });

  test("選択外→選択内（入力側）は維持して複製、選択内→選択外（出力側）は複製しない", () => {
    const g = sample();
    // b のみ複製: a→b(外→内) は a→b2 として複製、b→c(内→外) は複製しない
    const ids = duplicateNodes(g, new Set(["b"]), makeGenId(), 24);
    const b2 = ids[0]!;
    expect(g.connections.some((c) => c.from.node === "a" && c.to.node === b2 && c.to.port === "a")).toBe(true);
    expect(g.connections.some((c) => c.from.node === b2 && c.to.node === "c")).toBe(false);
    // 元の b→c は無傷
    expect(g.connections.some((c) => c.from.node === "b" && c.to.node === "c")).toBe(true);
  });

  test("複製で元のノード・エッジは変化しない", () => {
    const g = sample();
    const beforeNodes = structuredClone(g.nodes);
    const beforeConns = structuredClone(g.connections);
    duplicateNodes(g, new Set(["b", "c"]), makeGenId(), 24);
    for (const n of beforeNodes) expect(g.nodes.find((x) => x.id === n.id)).toEqual(n);
    for (const c of beforeConns) expect(g.connections.find((x) => x.id === c.id)).toEqual(c);
  });

  test("空選択は何もしない", () => {
    const g = sample();
    expect(duplicateNodes(g, new Set(), makeGenId(), 24)).toEqual([]);
    expect(g.nodes.length).toBe(3);
  });
});
