import { expect, test, describe } from "bun:test";
import { collectAssetRefs } from "./asset-refs";
import type { GraphDoc } from "../graph/graph-doc";

const graph: GraphDoc = {
  version: 1,
  nodes: [
    { id: "img", type: "ImageFileInput", params: { assetId: "h1" }, position: { x: 0, y: 0 } },
    { id: "vid", type: "VideoFileInput", params: { assetId: "" }, position: { x: 0, y: 0 } },
    { id: "num", type: "Number", params: { value: 1 }, position: { x: 0, y: 0 } },
  ],
  connections: [],
};

describe("collectAssetRefs", () => {
  test("assetId が非空のノードだけ集める", () => {
    expect(collectAssetRefs(graph)).toEqual([{ nodeId: "img", assetId: "h1" }]);
  });

  test("#205 padAssets 配列は slot=index 付きで集約（空要素はスキップ）", () => {
    const g: GraphDoc = {
      version: 1,
      nodes: [
        { id: "pad", type: "MidiPad", params: { padAssets: ["a", "", "c", ""] }, position: { x: 0, y: 0 } },
      ],
      connections: [],
    };
    expect(collectAssetRefs(g)).toEqual([
      { nodeId: "pad", assetId: "a", slot: 0 },
      { nodeId: "pad", assetId: "c", slot: 2 },
    ]);
  });

  test("#205 空の padAssets / 配列でない場合は何も拾わない", () => {
    const g: GraphDoc = {
      version: 1,
      nodes: [
        { id: "p1", type: "MidiPad", params: { padAssets: [] }, position: { x: 0, y: 0 } },
        { id: "p2", type: "MidiPad", params: {}, position: { x: 0, y: 0 } },
      ],
      connections: [],
    };
    expect(collectAssetRefs(g)).toEqual([]);
  });

  test("#205 単一 assetId と padAssets が混在しても両方拾う（assetId は slot 無し）", () => {
    const g: GraphDoc = {
      version: 1,
      nodes: [
        { id: "img", type: "ImageFileInput", params: { assetId: "h1" }, position: { x: 0, y: 0 } },
        { id: "pad", type: "MidiPad", params: { padAssets: ["", "x"] }, position: { x: 0, y: 0 } },
      ],
      connections: [],
    };
    expect(collectAssetRefs(g)).toEqual([
      { nodeId: "img", assetId: "h1" },
      { nodeId: "pad", assetId: "x", slot: 1 },
    ]);
  });
});
