import { expect, test, describe } from "bun:test";
import { hitTest } from "./hit-test";
import { NodeRegistry, type NodeTypeDef } from "../graph/node-type";
import type { NodeInstance } from "../graph/graph-doc";
import { TITLE_H, ROW_H, NODE_WIDTH, inputPortPos, outputPortPos, paramPortPos, paramRowY } from "./layout";

// Number 風: 出力のみ・value は noInput（param ドットなし）
const numberDef: NodeTypeDef = {
  type: "Num",
  inputs: [],
  outputs: [{ id: "out", label: "n", type: "number" }],
  params: [{ id: "value", label: "Value", kind: "number", default: 1, noInput: true }],
  evaluate: () => ({}),
};

// Visual 風: signal 入力 + 数値 param（ドットあり）
const visualDef: NodeTypeDef = {
  type: "Vis",
  inputs: [{ id: "pose", label: "pose", type: "pose" }],
  outputs: [],
  params: [
    { id: "radius", label: "radius", kind: "number", default: 0.4, min: 0, max: 3 },
  ],
  evaluate: () => ({}),
};

function makeRegistry(): NodeRegistry {
  const r = new NodeRegistry();
  r.register(numberDef);
  r.register(visualDef);
  return r;
}

const r = makeRegistry();

describe("hitTest の遮蔽（#80 回帰）", () => {
  test("手前ノードのタイトルが背後の param 行に重なる点では手前 node を返す", () => {
    // 背後: Num at (200,100)。Value 行 y = 100+26+22+11=159（portRows=1）
    const behind: NodeInstance = { id: "behind", type: "Num", params: {}, position: { x: 200, y: 100 } };
    // 手前: Vis at (180,140)。タイトル帯 y=140..166 が 159 を含む
    const front: NodeInstance = { id: "front", type: "Vis", params: {}, position: { x: 180, y: 140 } };
    const nodes = [behind, front]; // 後ろが手前（描画順）
    const hit = hitTest(nodes, r, 260, 159);
    expect(hit?.kind).toBe("node");
    expect(hit?.kind === "node" && hit.node.id).toBe("front");
  });

  test("両ノードの param 行が重なる点では手前（配列後方）の param を返す", () => {
    const a: NodeInstance = { id: "a", type: "Vis", params: {}, position: { x: 0, y: 0 } };
    const b: NodeInstance = { id: "b", type: "Vis", params: {}, position: { x: 20, y: 0 } }; // 手前・行 y は同じ
    const y = paramRowY(b, visualDef, 0);
    const hit = hitTest([a, b], r, 100, y); // x=100 は両 rect 内
    expect(hit?.kind).toBe("param");
    expect(hit?.kind === "param" && hit.node.id).toBe("b");
  });
});

describe("hitTest のポート/param/本体の優先", () => {
  const node: NodeInstance = { id: "n", type: "Vis", params: {}, position: { x: 100, y: 100 } };
  const nodes = [node];

  test("signal 入力ドット → port", () => {
    const p = inputPortPos(node, 0);
    const hit = hitTest(nodes, r, p.x, p.y);
    expect(hit?.kind).toBe("port");
    expect(hit?.kind === "port" && hit.port).toBe("pose");
    expect(hit?.kind === "port" && hit.portKind).toBe("input");
  });

  test("param ドット → port（param 行より優先）", () => {
    const p = paramPortPos(node, visualDef, 0);
    const hit = hitTest(nodes, r, p.x, p.y);
    expect(hit?.kind).toBe("port");
    expect(hit?.kind === "port" && hit.port).toBe("radius");
  });

  test("param 行（ドット以外）→ param", () => {
    const y = paramRowY(node, visualDef, 0);
    const hit = hitTest(nodes, r, 100 + NODE_WIDTH / 2, y);
    expect(hit?.kind).toBe("param");
    expect(hit?.kind === "param" && hit.paramIndex).toBe(0);
  });

  test("タイトル/本体 → node", () => {
    const hit = hitTest(nodes, r, 100 + 40, 100 + TITLE_H / 2);
    expect(hit?.kind).toBe("node");
  });

  test("noInput param の行左端はドットでなく param 行", () => {
    const num: NodeInstance = { id: "num", type: "Num", params: {}, position: { x: 0, y: 0 } };
    const y = paramRowY(num, numberDef, 0);
    const hit = hitTest([num], r, 1, y); // 左端ぎわ（rect 内）
    expect(hit?.kind).toBe("param");
  });

  test("何もない場所は null", () => {
    expect(hitTest(nodes, r, 1000, 1000)).toBeNull();
  });
});

describe("hitTest のドット余白の通過", () => {
  test("手前 rect 外のドット余白では下のノードの出力ドットに届く", () => {
    // behind の出力ドット（右端）x=0+NODE_WIDTH。front を少し右に置き、
    // front の左ドット余白（rect 外）と behind の出力ドットが重なる位置を作る。
    const behind: NodeInstance = { id: "behind", type: "Num", params: {}, position: { x: 0, y: 0 } };
    const out = outputPortPos(behind, 0); // (NODE_WIDTH, 26+11)
    // front の rect 左端を out.x+4 に（ドット余白はかかるが rect は含まない）
    const front: NodeInstance = { id: "front", type: "Vis", params: {}, position: { x: out.x + 4, y: -10 } };
    const hit = hitTest([behind, front], r, out.x, out.y);
    expect(hit?.kind).toBe("port");
    expect(hit?.kind === "port" && hit.node.id).toBe("behind");
  });
});
