import { expect, test, describe } from "bun:test";
import { pickScreenTextures } from "./texture-screen";
import { createGraph, addNode, type GraphDoc } from "./graph-doc";
import { NodeRegistry, type NodeTypeDef } from "./node-type";

// texture を出す visual / 画面出力 Screen のスタブ
function makeRegistry(): NodeRegistry {
  const r = new NodeRegistry();
  const visual: NodeTypeDef = {
    type: "Vis", category: "visual", isSink: true,
    inputs: [], outputs: [{ id: "texture", label: "tex", type: "texture" }],
    params: [], evaluate: () => ({}),
  };
  const screen: NodeTypeDef = {
    type: "Screen", category: "output", isSink: true,
    inputs: [{ id: "texture", label: "tex", type: "texture" }], outputs: [],
    params: [], evaluate: () => ({}),
  };
  const num: NodeTypeDef = {
    type: "Num", inputs: [], outputs: [{ id: "out", label: "n", type: "number" }],
    params: [], evaluate: () => ({}),
  };
  r.register(visual); r.register(screen); r.register(num);
  return r;
}

const r = makeRegistry();
const TEX_A = { id: "A" } as unknown as object;
const TEX_B = { id: "B" } as unknown as object;

function outputsMap(entries: Record<string, Record<string, unknown>>): Map<string, Record<string, unknown>> {
  return new Map(Object.entries(entries));
}

describe("pickScreenTextures", () => {
  test("Screen ノードがあればその入力 texture を優先（記録済み出力 _screenTexture）", () => {
    const g = createGraph();
    addNode(g, { id: "v", type: "Vis", params: {} });
    addNode(g, { id: "s", type: "Screen", params: {} });
    g.connections.push({ id: "c", from: { node: "v", port: "texture" }, to: { node: "s", port: "texture" } });
    const out = outputsMap({ v: { texture: TEX_A }, s: { _screenTexture: TEX_A } });
    expect(pickScreenTextures(g, r, out)).toEqual([TEX_A]);
  });

  test("#98: Screen が無ければ何も表示しない（フォールバック廃止）", () => {
    const g = createGraph();
    addNode(g, { id: "v1", type: "Vis", params: {} });
    addNode(g, { id: "v2", type: "Vis", params: {} });
    const out = outputsMap({ v1: { texture: TEX_A }, v2: { texture: TEX_B } });
    expect(pickScreenTextures(g, r, out)).toEqual([]);
  });

  test("#98: Screen が未記録（未評価相当）なら空", () => {
    const g = createGraph();
    addNode(g, { id: "v1", type: "Vis", params: {} });
    addNode(g, { id: "s", type: "Screen", params: {} });
    g.connections.push({ id: "c", from: { node: "v1", port: "texture" }, to: { node: "s", port: "texture" } });
    const out = outputsMap({ v1: { texture: TEX_A }, s: {} });
    expect(pickScreenTextures(g, r, out)).toEqual([]);
  });

  test("Screen が複数あればそれぞれの記録テクスチャを表示", () => {
    const g = createGraph();
    addNode(g, { id: "s1", type: "Screen", params: {} });
    addNode(g, { id: "s2", type: "Screen", params: {} });
    const out = outputsMap({ s1: { _screenTexture: TEX_A }, s2: { _screenTexture: TEX_B } });
    expect(pickScreenTextures(g, r, out)).toEqual([TEX_A, TEX_B]);
  });

  test("Screen が無ければ空（visual のみ）", () => {
    const g = createGraph();
    addNode(g, { id: "v", type: "Vis", params: {} });
    expect(pickScreenTextures(g, r, outputsMap({ v: { texture: TEX_A } }))).toEqual([]);
  });
});
