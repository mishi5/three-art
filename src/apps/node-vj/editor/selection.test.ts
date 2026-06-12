import { expect, test, describe } from "bun:test";
import { nodesInRect, normRect } from "./selection";
import { NodeRegistry, type NodeTypeDef } from "../graph/node-type";
import type { NodeInstance } from "../graph/graph-doc";

const def: NodeTypeDef = {
  type: "T", inputs: [], outputs: [{ id: "o", label: "o", type: "number" }],
  params: [], evaluate: () => ({}),
};
const r = new NodeRegistry();
r.register(def);

const nodes: NodeInstance[] = [
  { id: "a", type: "T", params: {}, position: { x: 0, y: 0 } },      // 0..168 × 0..~56
  { id: "b", type: "T", params: {}, position: { x: 400, y: 0 } },
];

describe("selection", () => {
  test("normRect は負方向ドラッグを正規化", () => {
    expect(normRect(100, 80, 20, 10)).toEqual({ x: 20, y: 10, w: 80, h: 70 });
  });

  test("交差するノードのみ選択", () => {
    expect(nodesInRect(nodes, r, { x: -10, y: -10, w: 60, h: 60 })).toEqual(["a"]);
    expect(nodesInRect(nodes, r, { x: 0, y: -10, w: 600, h: 80 })).toEqual(["a", "b"]);
    expect(nodesInRect(nodes, r, { x: 200, y: 200, w: 50, h: 50 })).toEqual([]);
  });

  test("一部交差でも選択（包含不要）", () => {
    expect(nodesInRect(nodes, r, { x: 160, y: 10, w: 20, h: 20 })).toEqual(["a"]);
  });
});
