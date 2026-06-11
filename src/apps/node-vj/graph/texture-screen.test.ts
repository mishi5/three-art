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

  test("Screen が無ければ texture 出力未接続の visual をフォールバック表示", () => {
    const g = createGraph();
    addNode(g, { id: "v1", type: "Vis", params: {} });
    addNode(g, { id: "v2", type: "Vis", params: {} });
    const out = outputsMap({ v1: { texture: TEX_A }, v2: { texture: TEX_B } });
    expect(pickScreenTextures(g, r, out)).toEqual([TEX_A, TEX_B]);
  });

  test("texture 出力が接続済みの visual はフォールバック対象外", () => {
    const g = createGraph();
    addNode(g, { id: "v1", type: "Vis", params: {} });
    addNode(g, { id: "v2", type: "Vis", params: {} });
    addNode(g, { id: "s", type: "Screen", params: {} });
    // v1 → Screen 接続。ただし Screen がまだ texture を記録していない（未評価相当）なら
    // v2（未接続）のみがフォールバック表示される
    g.connections.push({ id: "c", from: { node: "v1", port: "texture" }, to: { node: "s", port: "texture" } });
    const out = outputsMap({ v1: { texture: TEX_A }, v2: { texture: TEX_B }, s: {} });
    expect(pickScreenTextures(g, r, out)).toEqual([TEX_B]);
  });

  test("Screen が texture を記録していれば Screen のみ（フォールバック併用しない）", () => {
    const g = createGraph();
    addNode(g, { id: "v1", type: "Vis", params: {} });
    addNode(g, { id: "v2", type: "Vis", params: {} });
    addNode(g, { id: "s", type: "Screen", params: {} });
    g.connections.push({ id: "c", from: { node: "v1", port: "texture" }, to: { node: "s", port: "texture" } });
    const out = outputsMap({ v1: { texture: TEX_A }, v2: { texture: TEX_B }, s: { _screenTexture: TEX_A } });
    expect(pickScreenTextures(g, r, out)).toEqual([TEX_A]);
  });

  test("visual も Screen も無ければ空", () => {
    const g = createGraph();
    addNode(g, { id: "n", type: "Num", params: {} });
    expect(pickScreenTextures(g, r, outputsMap({ n: { out: 1 } }))).toEqual([]);
  });
});
