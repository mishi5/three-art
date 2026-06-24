import { expect, test, describe } from "bun:test";
import { serializeGraph, deserializeGraph } from "./serialize";
import { createGraph, addNode, addConnection, type GraphDoc } from "./graph-doc";
import { createDefaultRegistry } from "../nodes/registry";

const r = createDefaultRegistry();

function sampleGraph(): GraphDoc {
  const g = createGraph();
  addNode(g, { id: "n1", type: "Number", params: { value: 2.5, min: 0, max: 1 }, position: { x: 10, y: 20 } });
  addNode(g, { id: "m", type: "Multiply", params: { a: 1, b: 3 }, position: { x: 200, y: 50 } });
  addNode(g, { id: "rv", type: "RainVisual", params: { baseSpeed: 0.5, count: 1000, ampGain: 1, length: 0.06, areaWidth: 2, areaHeight: 2.4 }, position: { x: 400, y: 30 } });
  addConnection(g, r, { id: "c1", from: { node: "n1", port: "out" }, to: { node: "m", port: "a" } });
  addConnection(g, r, { id: "c2", from: { node: "m", port: "out" }, to: { node: "rv", port: "baseSpeed" } });
  return g;
}

describe("serializeGraph / deserializeGraph", () => {
  test("ラウンドトリップで同値（warnings なし）", () => {
    const g = sampleGraph();
    const text = serializeGraph(g);
    const { graph, warnings } = deserializeGraph(text, r);
    expect(warnings).toEqual([]);
    expect(graph).toEqual(g);
  });

  test("YAML として妥当な文字列を出力する", () => {
    const text = serializeGraph(sampleGraph());
    expect(text).toContain("version: 1");
    expect(text).toContain("type: Number");
  });

  test("未知ノード type は捨てて warning（その接続も消える）", () => {
    const g = sampleGraph();
    g.nodes.push({ id: "ghost", type: "NoSuchNode", params: {} });
    g.connections.push({ id: "cg", from: { node: "n1", port: "out" }, to: { node: "ghost", port: "x" } });
    const { graph, warnings } = deserializeGraph(serializeGraph(g), r);
    expect(graph.nodes.find((n) => n.id === "ghost")).toBeUndefined();
    expect(graph.connections.find((c) => c.id === "cg")).toBeUndefined();
    expect(warnings.length).toBeGreaterThanOrEqual(1);
  });

  test("params は既知 ParamDef にマージ（欠落=default・未知キー=捨てる）", () => {
    const g = createGraph();
    addNode(g, { id: "n", type: "Number", params: { value: 7, zombie: 1 } as Record<string, unknown> });
    const { graph } = deserializeGraph(serializeGraph(g), r);
    const node = graph.nodes[0]!;
    expect(node.params.value).toBe(7);
    expect("zombie" in node.params).toBe(false);
    // 欠落キーは default で補完される（Sine で確認）
    const g2 = createGraph();
    addNode(g2, { id: "s", type: "Sine", params: { freq: 2 } });
    const { graph: graph2 } = deserializeGraph(serializeGraph(g2), r);
    expect(graph2.nodes[0]!.params.amplitude).toBe(1); // default
    expect(graph2.nodes[0]!.params.freq).toBe(2);
  });

  test("不正接続（型不一致/不在ポート）は捨てて warning", () => {
    // 手書き YAML で audio→number の不正接続を混ぜる
    const text = [
      "version: 1",
      "nodes:",
      "  - id: a",
      "    type: AudioFileInput",
      "    params: {}",
      "  - id: m",
      "    type: Multiply",
      "    params: {}",
      "connections:",
      "  - id: bad1",
      "    from: { node: a, port: audio }",
      "    to: { node: m, port: a }",        // audio→number 型不一致
      "  - id: bad2",
      "    from: { node: a, port: nope }",   // 不在ポート
      "    to: { node: m, port: b }",
      "  - id: ok",
      "    from: { node: a, port: bass }",
      "    to: { node: m, port: b }",        // number→number OK
    ].join("\n");
    const { graph, warnings } = deserializeGraph(text, r);
    expect(graph.connections.map((c) => c.id)).toEqual(["ok"]);
    expect(warnings.length).toBe(2);
  });

  test("preview フラグはラウンドトリップで保持される", () => {
    const g = createGraph();
    addNode(g, { id: "v", type: "RainVisual", params: {}, preview: true });
    const { graph } = deserializeGraph(serializeGraph(g), r);
    expect(graph.nodes[0]!.preview).toBe(true);
  });

  test("#154 assetId param が round-trip で保持される", () => {
    const g = createGraph();
    addNode(g, { id: "img", type: "ImageFileInput", params: { assetId: "abc123" }, position: { x: 10, y: 20 } });
    const { graph } = deserializeGraph(serializeGraph(g), r);
    const img = graph.nodes.find((n) => n.id === "img");
    expect(img?.params.assetId).toBe("abc123");
  });

  test("#176 自由ラベルと node.name が round-trip（形不正は破棄）", () => {
    const g = createGraph();
    addNode(g, { id: "n1", type: "Number", params: { value: 1 }, name: "速度" });
    g.labels = [
      { id: "L1", x: 10, y: 20, text: "メモ" },
      { id: "L2", x: 0, y: 0 } as never, // text 欠落 → 破棄
    ];
    const { graph, warnings } = deserializeGraph(serializeGraph(g), r);
    expect(graph.nodes[0]!.name).toBe("速度");
    expect(graph.labels?.length).toBe(1);
    expect(graph.labels![0]!.text).toBe("メモ");
    expect(warnings.some((w) => w.includes("label"))).toBe(true);
  });

  test("#175 groups が round-trip（存在しない nodeId は除去・2 未満は破棄）", () => {
    const g = createGraph();
    addNode(g, { id: "n1", type: "Number", params: { value: 1 } });
    addNode(g, { id: "m", type: "Multiply", params: {} });
    g.groups = [
      { id: "g1", name: "Pair", nodeIds: ["n1", "m"] },
      { id: "g2", nodeIds: ["n1", "ghost"] },
    ];
    const { graph, warnings } = deserializeGraph(serializeGraph(g), r);
    expect(graph.groups?.length).toBe(1);
    expect(graph.groups![0]!.id).toBe("g1");
    expect(graph.groups![0]!.name).toBe("Pair");
    expect(graph.groups![0]!.nodeIds.slice().sort()).toEqual(["m", "n1"]);
    expect(warnings.some((w) => w.includes("g2"))).toBe(true);
  });

  test("version 不一致は throw", () => {
    expect(() => deserializeGraph("version: 99\nnodes: []\nconnections: []", r)).toThrow();
  });

  test("壊れた YAML / 形でないものは throw", () => {
    expect(() => deserializeGraph(": :: not yaml", r)).toThrow();
    expect(() => deserializeGraph("42", r)).toThrow();
  });
});
