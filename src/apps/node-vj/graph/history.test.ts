import { expect, test, describe } from "bun:test";
import { History } from "./history";
import { createGraph, addNode, type GraphDoc } from "./graph-doc";

function g1(): GraphDoc {
  const g = createGraph();
  addNode(g, { id: "a", type: "Number", params: { value: 1 } });
  return g;
}

describe("History", () => {
  test("record → mutate → undo で元の状態が返り、redo で再適用できる", () => {
    const h = new History();
    const g = g1();
    h.record(g);                       // 変更直前を記録
    g.nodes[0]!.params.value = 99;     // 変更
    expect(h.canUndo).toBe(true);
    const back = h.undo(g)!;
    expect(back.nodes[0]!.params.value).toBe(1);   // 巻き戻し先
    expect(h.canRedo).toBe(true);
    const again = h.redo(back)!;
    expect(again.nodes[0]!.params.value).toBe(99); // やり直し先
  });

  test("record は深いコピー（後からの変更が履歴を汚さない）", () => {
    const h = new History();
    const g = g1();
    h.record(g);
    g.nodes[0]!.params.value = 5;
    expect(h.undo(g)!.nodes[0]!.params.value).toBe(1);
  });

  test("record で redo スタックはクリアされる", () => {
    const h = new History();
    const g = g1();
    h.record(g); g.nodes[0]!.params.value = 2;
    const back = h.undo(g)!;
    expect(h.canRedo).toBe(true);
    h.record(back);                    // 新たな操作
    expect(h.canRedo).toBe(false);
  });

  test("上限 50 を超えると古い順に破棄", () => {
    const h = new History();
    const g = g1();
    for (let i = 0; i < 60; i++) {
      h.record(g);
      g.nodes[0]!.params.value = i;
    }
    let count = 0;
    let cur: GraphDoc | null = g;
    while (h.canUndo && cur) { cur = h.undo(cur); count++; }
    expect(count).toBe(50);
  });

  test("discardLast は直前の record を取り消す", () => {
    const h = new History();
    const g = g1();
    h.record(g);
    h.discardLast();
    expect(h.canUndo).toBe(false);
  });

  test("clear で両スタックが空に", () => {
    const h = new History();
    const g = g1();
    h.record(g); g.nodes[0]!.params.value = 2;
    h.undo(g);
    h.clear();
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
  });

  test("空の undo/redo は null", () => {
    const h = new History();
    expect(h.undo(g1())).toBeNull();
    expect(h.redo(g1())).toBeNull();
  });
});
