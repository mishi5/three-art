import { expect, test, describe } from "bun:test";
import { assetDropTarget, nodeTypeForKind } from "./asset-drop";
import { createDefaultRegistry } from "../nodes/registry";
import { createGraph, addNode } from "../graph/graph-doc";
import { nodeRect } from "../editor/layout";

describe("assetDropTarget", () => {
  test("ノード本体内ならノード id、外なら null", () => {
    const reg = createDefaultRegistry();
    const g = createGraph();
    addNode(g, { id: "img", type: "ImageFileInput", params: { assetId: "" }, position: { x: 100, y: 100 } });
    const def = reg.require("ImageFileInput");
    const r = nodeRect(g.nodes[0]!, def);
    // ノード本体の中心（ファイル行に限らない）でも割当先になる
    expect(assetDropTarget(g, reg, r.x + r.w / 2, r.y + r.h / 2)).toBe("img");
    // タイトル付近（上端）でも本体内なら割当先
    expect(assetDropTarget(g, reg, r.x + 10, r.y + 5)).toBe("img");
    // ノード外は null
    expect(assetDropTarget(g, reg, r.x - 50, r.y - 50)).toBeNull();
  });

  test("ファイル入力でないノード上は対象外（null）", () => {
    const reg = createDefaultRegistry();
    const g = createGraph();
    addNode(g, { id: "num", type: "Number", params: { value: 1 }, position: { x: 0, y: 0 } });
    const def = reg.require("Number");
    const r = nodeRect(g.nodes[0]!, def);
    expect(assetDropTarget(g, reg, r.x + r.w / 2, r.y + r.h / 2)).toBeNull();
  });
});

describe("nodeTypeForKind", () => {
  test("種別 → ファイル入力ノード型", () => {
    expect(nodeTypeForKind("image")).toBe("ImageFileInput");
    expect(nodeTypeForKind("video")).toBe("VideoFileInput");
    expect(nodeTypeForKind("audio")).toBe("AudioFileInput");
  });
});
