import { expect, test, describe } from "bun:test";
import { evaluate, getSinks } from "./evaluator";
import { createGraph, addNode, addConnection, type GraphDoc } from "./graph-doc";
import { NodeRegistry, type NodeTypeDef } from "./node-type";

// 評価回数を数えられるテスト用レジストリ。
function setup() {
  const counts = new Map<string, number>();
  const r = new NodeRegistry();

  // 定数: param value を outN へ
  r.register({
    type: "Const", inputs: [], outputs: [{ id: "outN", label: "n", type: "number" }],
    params: [{ id: "value", label: "v", kind: "number", default: 0 }],
    evaluate: (ctx) => {
      counts.set(ctx.node.id, (counts.get(ctx.node.id) ?? 0) + 1);
      return { outN: ctx.param("value") };
    },
  });
  // 加算: inA + inB → outN（未接続入力は param フォールバック）
  r.register({
    type: "Add",
    inputs: [{ id: "inA", label: "a", type: "number" }, { id: "inB", label: "b", type: "number" }],
    outputs: [{ id: "outN", label: "n", type: "number" }],
    params: [{ id: "inA", label: "a", kind: "number", default: 0 }, { id: "inB", label: "b", kind: "number", default: 0 }],
    evaluate: (ctx) => {
      counts.set(ctx.node.id, (counts.get(ctx.node.id) ?? 0) + 1);
      return { outN: (ctx.input("inA") as number) + (ctx.input("inB") as number) };
    },
  });
  // sink: inN を記録（副作用ノード）
  const sunk: number[] = [];
  r.register({
    type: "Sink", isSink: true,
    inputs: [{ id: "inN", label: "n", type: "number" }], outputs: [], params: [],
    evaluate: (ctx) => { sunk.push(ctx.input("inN") as number); return {}; },
  });

  return { r, counts, sunk };
}

const conn = (id: string, fn: string, fp: string, tn: string, tp: string) =>
  ({ id, from: { node: fn, port: fp }, to: { node: tn, port: tp } });

describe("evaluator", () => {
  test("トポロジカルに上流→下流を評価し sink に値が届く", () => {
    const { r, sunk } = setup();
    const g = createGraph();
    addNode(g, { id: "c1", type: "Const", params: { value: 3 } });
    addNode(g, { id: "c2", type: "Const", params: { value: 4 } });
    addNode(g, { id: "add", type: "Add", params: {} });
    addNode(g, { id: "s", type: "Sink", params: {} });
    expect(addConnection(g, r, conn("e1", "c1", "outN", "add", "inA")).ok).toBe(true);
    expect(addConnection(g, r, conn("e2", "c2", "outN", "add", "inB")).ok).toBe(true);
    expect(addConnection(g, r, conn("e3", "add", "outN", "s", "inN")).ok).toBe(true);
    evaluate(g, r, { timeSec: 0 });
    expect(sunk).toEqual([7]);
  });

  test("共有上流ノードはフレーム内 1 回だけ評価（メモ化）", () => {
    const { r, counts } = setup();
    const g = createGraph();
    addNode(g, { id: "c", type: "Const", params: { value: 5 } });
    // add1, add2 が同じ c を入力に使う。さらに両者を sink 用 add3 に集約。
    addNode(g, { id: "a1", type: "Add", params: {} });
    addNode(g, { id: "a2", type: "Add", params: {} });
    addNode(g, { id: "a3", type: "Add", params: {} });
    addNode(g, { id: "s", type: "Sink", params: {} });
    addConnection(g, r, conn("e1", "c", "outN", "a1", "inA"));
    addConnection(g, r, conn("e2", "c", "outN", "a2", "inA"));
    addConnection(g, r, conn("e3", "a1", "outN", "a3", "inA"));
    addConnection(g, r, conn("e4", "a2", "outN", "a3", "inB"));
    addConnection(g, r, conn("e5", "a3", "outN", "s", "inN"));
    evaluate(g, r, { timeSec: 0 });
    expect(counts.get("c")).toBe(1);
  });

  test("未接続入力は param 値にフォールバック", () => {
    const { r, sunk } = setup();
    const g = createGraph();
    addNode(g, { id: "add", type: "Add", params: { inA: 10, inB: 2 } });
    addNode(g, { id: "s", type: "Sink", params: {} });
    addConnection(g, r, conn("e1", "add", "outN", "s", "inN"));
    evaluate(g, r, { timeSec: 0 });
    expect(sunk).toEqual([12]);
  });

  test("#208 outputScales 無しなら従来と完全に同じ値（回帰防止）", () => {
    const { r, sunk } = setup();
    const g = createGraph();
    addNode(g, { id: "c1", type: "Const", params: { value: 3 } });
    addNode(g, { id: "s", type: "Sink", params: {} });
    addConnection(g, r, conn("e1", "c1", "outN", "s", "inN"));
    evaluate(g, r, { timeSec: 0 });
    expect(sunk).toEqual([3]);
  });

  test("#208 number 出力に倍率が掛かって下流へ流れる", () => {
    const { r, sunk } = setup();
    const g = createGraph();
    addNode(g, { id: "c1", type: "Const", params: { value: 3 }, outputScales: { outN: 2 } });
    addNode(g, { id: "s", type: "Sink", params: {} });
    addConnection(g, r, conn("e1", "c1", "outN", "s", "inN"));
    evaluate(g, r, { timeSec: 0 });
    expect(sunk).toEqual([6]);
  });

  test("#208 倍率 1 は従来と同じ（素通し）", () => {
    const { r, sunk } = setup();
    const g = createGraph();
    addNode(g, { id: "c1", type: "Const", params: { value: 5 }, outputScales: { outN: 1 } });
    addNode(g, { id: "s", type: "Sink", params: {} });
    addConnection(g, r, conn("e1", "c1", "outN", "s", "inN"));
    evaluate(g, r, { timeSec: 0 });
    expect(sunk).toEqual([5]);
  });

  test("#208 倍率は memo（getOutputs 相当）にも反映される", () => {
    const { r } = setup();
    const g = createGraph();
    addNode(g, { id: "c1", type: "Const", params: { value: 4 }, outputScales: { outN: 0.5 } });
    const memo = evaluate(g, r, { timeSec: 0 });
    expect(memo.get("c1")).toEqual({ outN: 2 });
  });

  test("getSinks は isSink と出力辺なしを sink とみなす", () => {
    const { r } = setup();
    const g = createGraph();
    addNode(g, { id: "c", type: "Const", params: {} });   // 出力辺なし → sink
    addNode(g, { id: "s", type: "Sink", params: {} });     // isSink
    const ids = getSinks(g, r).map((n) => n.id).sort();
    expect(ids).toEqual(["c", "s"]);
  });

  // #213 多層防御: 未知ノード型が残っても throw せずスキップする。
  test("未知ノード型はスキップし throw しない（空出力）", () => {
    const { r, sunk } = setup();
    const g = createGraph();
    // ghost は未登録 type。それ自体が sink（出力辺なし）としても評価対象になる。
    addNode(g, { id: "ghost", type: "NoSuchNode", params: {} });
    let memo!: Map<string, Record<string, unknown>>;
    expect(() => { memo = evaluate(g, r, { timeSec: 0 }); }).not.toThrow();
    expect(memo.get("ghost")).toEqual({});
    expect(sunk).toEqual([]);
  });

  test("未知ノードを上流に持つ接続は undefined を渡すだけでクラッシュしない", () => {
    const { r, sunk } = setup();
    const g = createGraph();
    addNode(g, { id: "ghost", type: "NoSuchNode", params: {} });
    addNode(g, { id: "s", type: "Sink", params: {} });
    // 未知ノードからの接続は addConnection で拒否されるため、上流未知の評価経路を
    // 確実に通すよう接続を直接注入する（保険の多層防御を検証する）。
    g.connections.push({ id: "c", from: { node: "ghost", port: "outN" }, to: { node: "s", port: "inN" } });
    expect(() => evaluate(g, r, { timeSec: 0 })).not.toThrow();
    // 未知ノードの出力は空なので inN は undefined。
    expect(sunk).toEqual([undefined as unknown as number]);
  });
});
