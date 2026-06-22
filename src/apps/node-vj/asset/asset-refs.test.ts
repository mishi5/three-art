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
});
