import { expect, test, describe } from "bun:test";
import { NumberNode } from "./NumberNode";

describe("NumberNode ランダムボタン (#150)", () => {
  test("value/min/max param を持ち、min/max は入力ポート無し", () => {
    const ids = NumberNode.params.map((p) => p.id);
    expect(ids).toEqual(["value", "min", "max"]);
    const min = NumberNode.params.find((p) => p.id === "min");
    const max = NumberNode.params.find((p) => p.id === "max");
    expect(min?.kind).toBe("number");
    expect(max?.kind).toBe("number");
    expect(min?.noInput).toBe(true);
    expect(max?.noInput).toBe(true);
  });

  test("randomButton が value を対象に設定されている", () => {
    expect(NumberNode.randomButton?.paramId).toBe("value");
  });

  test("evaluate は value をそのまま出力する", () => {
    const out = NumberNode.evaluate({
      timeSec: 0,
      input: () => undefined,
      param: (id) => (id === "value" ? 0.42 : undefined),
      node: { id: "n", type: "Number", params: {} },
    });
    expect(out.out).toBe(0.42);
  });
});
