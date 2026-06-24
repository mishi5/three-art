import { expect, test, describe } from "bun:test";
import { createGraph, addLabel, removeLabel, replaceGraph } from "./graph-doc";

describe("text label", () => {
  test("addLabel / removeLabel / replaceGraph コピー", () => {
    const g = createGraph();
    addLabel(g, { id: "L1", x: 10, y: 20, text: "intro" });
    expect(g.labels?.length).toBe(1);
    const target = createGraph();
    replaceGraph(target, g);
    expect(target.labels?.[0]?.text).toBe("intro");
    removeLabel(g, "L1");
    expect(g.labels ?? []).toEqual([]);
  });
});
