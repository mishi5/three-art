import { expect, test, describe } from "bun:test";
import {
  applyOutputScales, getOutputScale, setOutputScale, formatScale, DEFAULT_OUTPUT_SCALE,
} from "./output-scale";
import type { NodeInstance } from "./graph-doc";
import type { NodeTypeDef } from "./node-type";

// 出力ポート: number 2 本（n, m）と非 number 1 本（sig）を持つテスト用 def。
const def: NodeTypeDef = {
  type: "T",
  inputs: [],
  outputs: [
    { id: "n", label: "n", type: "number" },
    { id: "m", label: "m", type: "number" },
    { id: "sig", label: "s", type: "signal" },
  ],
  params: [],
  evaluate: () => ({}),
};

describe("applyOutputScales", () => {
  test("scales 未指定なら入力 outputs をそのまま（参照不変）返す", () => {
    const out = { n: 3, m: 4, sig: "x" };
    expect(applyOutputScales(out, def, undefined)).toBe(out);
  });

  test("全ポート既定 1（または空）なら参照不変＝完全に同じ挙動", () => {
    const out = { n: 3, m: 4, sig: "x" };
    expect(applyOutputScales(out, def, {})).toBe(out);
    expect(applyOutputScales(out, def, { n: 1, m: 1 })).toBe(out);
  });

  test("number 出力に倍率を掛ける（元の値 × 倍率）", () => {
    const out = { n: 3, m: 4, sig: "x" };
    const res = applyOutputScales(out, def, { n: 2, m: 0.5 });
    expect(res).toEqual({ n: 6, m: 2, sig: "x" });
    expect(res).not.toBe(out); // 変更時は新オブジェクト
    expect(out.n).toBe(3); // 元は不変
  });

  test("number 以外の出力には掛けない（signal は素通し）", () => {
    const out = { n: 3, sig: 5 };
    // sig ポートに倍率を指定しても type!=number なので無視
    const res = applyOutputScales(out, def, { sig: 10 });
    expect(res).toBe(out);
  });

  test("出力値が NaN/undefined/非 number のポートは素通し", () => {
    const out: Record<string, unknown> = { n: NaN, m: undefined };
    const res = applyOutputScales(out, def, { n: 2, m: 2 });
    expect(res).toBe(out);
  });

  test("非有限/非数値の倍率は無視（既定 1 扱い）", () => {
    const out = { n: 3, m: 4 };
    const res = applyOutputScales(out, def, { n: Infinity, m: NaN as number });
    expect(res).toBe(out);
  });

  test("一部ポートだけ掛ける場合も他値は保持", () => {
    const out = { n: 3, m: 4, sig: "x" };
    const res = applyOutputScales(out, def, { n: 3 });
    expect(res).toEqual({ n: 9, m: 4, sig: "x" });
  });
});

describe("getOutputScale / setOutputScale", () => {
  test("未設定は既定 1", () => {
    const node: NodeInstance = { id: "a", type: "T", params: {} };
    expect(getOutputScale(node, "n")).toBe(DEFAULT_OUTPUT_SCALE);
  });

  test("set で値を保持・get で取得", () => {
    const node: NodeInstance = { id: "a", type: "T", params: {} };
    setOutputScale(node, "n", 2.5);
    expect(node.outputScales).toEqual({ n: 2.5 });
    expect(getOutputScale(node, "n")).toBe(2.5);
  });

  test("既定 1 を設定するとエントリ削除（クリーンに保つ）", () => {
    const node: NodeInstance = { id: "a", type: "T", params: {}, outputScales: { n: 2 } };
    setOutputScale(node, "n", 1);
    expect(node.outputScales).toBeUndefined();
  });

  test("非有限値の設定は削除扱い", () => {
    const node: NodeInstance = { id: "a", type: "T", params: {}, outputScales: { n: 2, m: 3 } };
    setOutputScale(node, "n", NaN);
    expect(node.outputScales).toEqual({ m: 3 });
  });
});

describe("formatScale", () => {
  test("整数は小数なし", () => {
    expect(formatScale(2)).toBe("×2");
    expect(formatScale(1)).toBe("×1");
  });
  test("小数は簡潔表示", () => {
    expect(formatScale(0.5)).toBe("×0.5");
    expect(formatScale(1.25)).toBe("×1.25");
  });
});
