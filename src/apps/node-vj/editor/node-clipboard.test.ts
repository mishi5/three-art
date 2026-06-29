import { expect, test, describe } from "bun:test";
import {
  extractClip, pasteClip, clipLabel, makeClipItem, NodeClipboard,
  type ClipItem,
} from "./node-clipboard";
import { createGraph, addNode, type GraphDoc, type NodeInstance } from "../graph/graph-doc";
import { NodeRegistry, type NodeTypeDef } from "../graph/node-type";

// number 入出力を持つスタブノード種別（接続検証用）。
function makeRegistry(): NodeRegistry {
  const r = new NodeRegistry();
  const def = (type: string): NodeTypeDef => ({
    type,
    inputs: [
      { id: "inN", label: "n", type: "number" },
      { id: "inP", label: "p", type: "pose" },
    ],
    outputs: [{ id: "outN", label: "n", type: "number" }],
    params: [],
    evaluate: () => ({}),
  });
  r.register(def("A"));
  r.register(def("B"));
  r.register(def("C"));
  return r;
}

function node(id: string, type = "A", x = 0, y = 0): NodeInstance {
  return { id, type, params: {}, position: { x, y } };
}

/** a → b → c（b,c が選択対象想定）。 */
function sample(): GraphDoc {
  const g = createGraph();
  addNode(g, node("a", "A", 0, 0));
  addNode(g, node("b", "B", 100, 50));
  addNode(g, node("c", "C", 200, 80));
  g.connections.push(
    { id: "e1", from: { node: "a", port: "outN" }, to: { node: "b", port: "inN" } }, // 外→内
    { id: "e2", from: { node: "b", port: "outN" }, to: { node: "c", port: "inN" } }, // 内→内
  );
  return g;
}

function makeGenId(): (prefix: string) => string {
  let i = 0;
  return (p) => `${p}_${++i}`;
}

describe("extractClip", () => {
  test("選択ノードを deep clone し、両端が選択内の接続のみ含める", () => {
    const g = sample();
    const clip = extractClip(g, new Set(["b", "c"]));
    expect(clip.nodes.map((n) => n.id).sort()).toEqual(["b", "c"]);
    // 内部接続 e2 のみ（外→内 e1 は除外）
    expect(clip.connections.length).toBe(1);
    expect(clip.connections[0]!.from.node).toBe("b");
    expect(clip.connections[0]!.to.node).toBe("c");
    // deep clone（元 params と別参照）
    expect(clip.nodes[0]!.params).not.toBe(g.nodes.find((n) => n.id === clip.nodes[0]!.id)!.params);
  });

  test("単一選択は接続を含まない", () => {
    const g = sample();
    const clip = extractClip(g, new Set(["b"]));
    expect(clip.nodes.length).toBe(1);
    expect(clip.connections.length).toBe(0);
  });

  test("空選択は空のクリップ", () => {
    const g = sample();
    const clip = extractClip(g, new Set());
    expect(clip.nodes).toEqual([]);
    expect(clip.connections).toEqual([]);
  });
});

describe("pasteClip", () => {
  test("再 id 後も内部接続が保たれ、元グラフは無変更（往復）", () => {
    const src = sample();
    const clip = extractClip(src, new Set(["b", "c"]));
    const item: ClipItem = { id: "clip1", ...clip, label: clipLabel(clip.nodes) };

    const dst = createGraph();
    const reg = makeRegistry();
    const newIds = pasteClip(dst, reg, item, makeGenId(), { offset: 24 });

    expect(newIds.length).toBe(2);
    expect(dst.nodes.length).toBe(2);
    // 内部接続が新 id 間で再構築されている
    expect(dst.connections.length).toBe(1);
    const conn = dst.connections[0]!;
    expect(newIds.includes(conn.from.node)).toBe(true);
    expect(newIds.includes(conn.to.node)).toBe(true);
    expect(conn.from.port).toBe("outN");
    expect(conn.to.port).toBe("inN");
    // 元クリップ項目は不変（再 id でも item.nodes の id は元のまま）
    expect(item.nodes.map((n) => n.id).sort()).toEqual(["b", "c"]);
  });

  test("offset 指定で元位置 + offset に配置", () => {
    const src = sample();
    const item: ClipItem = { id: "c", ...extractClip(src, new Set(["b"])), label: "x" };
    const dst = createGraph();
    const ids = pasteClip(dst, makeRegistry(), item, makeGenId(), { offset: 24 });
    const n = dst.nodes.find((x) => x.id === ids[0])!;
    expect(n.position).toEqual({ x: 124, y: 74 }); // (100,50)+24
  });

  test("at 指定で部分グラフの左上を at に合わせる", () => {
    const src = sample();
    const item: ClipItem = { id: "c", ...extractClip(src, new Set(["b", "c"])), label: "x" };
    const dst = createGraph();
    const ids = pasteClip(dst, makeRegistry(), item, makeGenId(), { at: { x: 500, y: 500 } });
    const ns = ids.map((id) => dst.nodes.find((x) => x.id === id)!);
    // 左上(b: 100,50)が(500,500)へ → c(200,80) は (600,530)
    const minX = Math.min(...ns.map((n) => n.position!.x));
    const minY = Math.min(...ns.map((n) => n.position!.y));
    expect(minX).toBe(500);
    expect(minY).toBe(500);
  });

  test("空クリップの貼付は何もしない", () => {
    const dst = createGraph();
    const item: ClipItem = { id: "c", nodes: [], connections: [], label: "(空)" };
    expect(pasteClip(dst, makeRegistry(), item, makeGenId(), {})).toEqual([]);
    expect(dst.nodes.length).toBe(0);
  });

  test("複数回貼付で id が衝突しない（連続貼付）", () => {
    const src = sample();
    const item: ClipItem = { id: "c", ...extractClip(src, new Set(["b", "c"])), label: "x" };
    const dst = createGraph();
    const gen = makeGenId();
    const a = pasteClip(dst, makeRegistry(), item, gen, { offset: 24 });
    const b = pasteClip(dst, makeRegistry(), item, gen, { offset: 48 });
    expect(dst.nodes.length).toBe(4);
    expect(new Set([...a, ...b]).size).toBe(4); // 全 id ユニーク
  });
});

describe("clipLabel", () => {
  test("3 件以下は型名を列挙", () => {
    expect(clipLabel([node("a", "Number"), node("b", "Add")])).toBe("Number, Add");
  });
  test("4 件以上は先頭 2 型 + 残り件数", () => {
    const ns = ["A", "B", "C", "D"].map((t, i) => node(`n${i}`, t));
    expect(clipLabel(ns)).toBe("A, B 他 2 件");
  });
  test("空は (空)", () => {
    expect(clipLabel([])).toBe("(空)");
  });
});

describe("makeClipItem", () => {
  test("選択からラベル付きクリップ項目を生成", () => {
    const g = sample();
    const item = makeClipItem(g, new Set(["b", "c"]), makeGenId());
    expect(item).not.toBeNull();
    expect(item!.nodes.length).toBe(2);
    expect(item!.label).toBe("B, C");
    expect(item!.id).toMatch(/^clip_/);
  });
  test("空選択は null", () => {
    const g = sample();
    expect(makeClipItem(g, new Set(), makeGenId())).toBeNull();
  });
});

describe("NodeClipboard", () => {
  function item(id: string): ClipItem {
    return { id, nodes: [node(id)], connections: [], label: id };
  }

  test("add で先頭に積まれ、current は最後に追加した項目", () => {
    const cb = new NodeClipboard();
    cb.add(item("a"));
    cb.add(item("b"));
    expect(cb.list().map((i) => i.id)).toEqual(["b", "a"]);
    expect(cb.current()!.id).toBe("b");
  });

  test("setCurrent で current を切替", () => {
    const cb = new NodeClipboard();
    cb.add(item("a"));
    cb.add(item("b"));
    cb.setCurrent("a");
    expect(cb.current()!.id).toBe("a");
    expect(cb.currentItemId()).toBe("a");
  });

  test("存在しない id への setCurrent は無視", () => {
    const cb = new NodeClipboard();
    cb.add(item("a"));
    cb.setCurrent("zzz");
    expect(cb.current()!.id).toBe("a");
  });

  test("上限を超えると古い項目を捨てる", () => {
    const cb = new NodeClipboard(3);
    for (const id of ["a", "b", "c", "d"]) cb.add(item(id));
    expect(cb.list().map((i) => i.id)).toEqual(["d", "c", "b"]);
    expect(cb.get("a")).toBeUndefined();
  });

  test("onChange は add/setCurrent で発火し、解除できる", () => {
    const cb = new NodeClipboard();
    let n = 0;
    const off = cb.onChange(() => { n++; });
    cb.add(item("a"));
    cb.add(item("b"));
    cb.setCurrent("a");
    expect(n).toBe(3);
    off();
    cb.add(item("c"));
    expect(n).toBe(3);
  });
});
