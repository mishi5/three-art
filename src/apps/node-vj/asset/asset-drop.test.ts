import { expect, test, describe } from "bun:test";
import { assetDropTarget } from "./asset-drop";
import { createDefaultRegistry } from "../nodes/registry";
import { createGraph, addNode } from "../graph/graph-doc";
import { fileRowRect } from "../editor/layout";

describe("assetDropTarget", () => {
  test("ファイル行矩形内ならノード id、外なら null", () => {
    const reg = createDefaultRegistry();
    const g = createGraph();
    addNode(g, { id: "img", type: "ImageFileInput", params: { assetId: "" }, position: { x: 100, y: 100 } });
    const def = reg.require("ImageFileInput");
    // layout.fileRowRect で実際のファイル行矩形を求めてから内外を判定する
    const r = fileRowRect(g.nodes[0]!, def)!;
    expect(assetDropTarget(g, reg, r.x + r.w / 2, r.y + r.h / 2)).toBe("img");
    expect(assetDropTarget(g, reg, r.x - 50, r.y - 50)).toBeNull();
  });
});
