import { expect, test, describe } from "bun:test";
import { tooltipForHit, tooltipBox, wrapLines, nodeMenuTooltipContent } from "./tooltip";
import { NodeRegistry, type NodeTypeDef } from "../graph/node-type";
import type { NodeInstance } from "../graph/graph-doc";
import type { HitResult } from "./hit-test";

// 説明付きノード: ノード説明 / param 説明 / 出力ポート説明 / param 入力ポート説明
const describedDef: NodeTypeDef = {
  type: "Desc",
  description: "ノード全体の説明",
  inputs: [{ id: "in", label: "入力", type: "number", description: "入力ポートの説明" }],
  outputs: [{ id: "out", label: "出力", type: "number", description: "出力ポートの説明" }],
  params: [
    { id: "gain", label: "Gain", kind: "number", default: 1, description: "ゲインの説明" },
    { id: "raw", label: "Raw", kind: "number", default: 0 }, // 説明なし
  ],
  evaluate: () => ({}),
};

function makeRegistry(): NodeRegistry {
  const r = new NodeRegistry();
  r.register(describedDef);
  return r;
}

const r = makeRegistry();
const node: NodeInstance = { id: "n", type: "Desc", params: {}, position: { x: 0, y: 0 } };

describe("tooltipForHit", () => {
  test("node ヒット → ノード説明（タイトルは type）", () => {
    const hit: HitResult = { kind: "node", node };
    expect(tooltipForHit(hit, r)).toEqual({ title: "Desc", body: "ノード全体の説明" });
  });

  test("param ヒット（説明あり）→ param 説明（タイトルは label）", () => {
    const hit: HitResult = { kind: "param", node, paramIndex: 0 };
    expect(tooltipForHit(hit, r)).toEqual({ title: "Gain", body: "ゲインの説明" });
  });

  test("param ヒット（説明なし）→ null", () => {
    const hit: HitResult = { kind: "param", node, paramIndex: 1 };
    expect(tooltipForHit(hit, r)).toBeNull();
  });

  test("出力ポートヒット → ポート説明", () => {
    const hit: HitResult = { kind: "port", node, port: "out", portKind: "output", type: "number" };
    expect(tooltipForHit(hit, r)).toEqual({ title: "出力", body: "出力ポートの説明" });
  });

  test("signal 入力ポートヒット → ポート説明", () => {
    const hit: HitResult = { kind: "port", node, port: "in", portKind: "input", type: "number" };
    expect(tooltipForHit(hit, r)).toEqual({ title: "入力", body: "入力ポートの説明" });
  });

  test("param 入力ポートヒット → param 説明（params から解決）", () => {
    const hit: HitResult = { kind: "port", node, port: "gain", portKind: "input", type: "number" };
    expect(tooltipForHit(hit, r)).toEqual({ title: "Gain", body: "ゲインの説明" });
  });

  test("null ヒット → null", () => {
    expect(tooltipForHit(null, r)).toBeNull();
  });

  test("未登録 type → null", () => {
    const ghost: NodeInstance = { id: "g", type: "Nope", params: {}, position: { x: 0, y: 0 } };
    expect(tooltipForHit({ kind: "node", node: ghost }, r)).toBeNull();
  });
});

describe("tooltipBox 画面端回避", () => {
  test("通常はカーソル右下に出す", () => {
    const b = tooltipBox(100, 100, 200, 60, 1000, 800);
    expect(b.x).toBeGreaterThan(100);
    expect(b.y).toBeGreaterThan(100);
  });

  test("右端で左へ反転（はみ出さない）", () => {
    const b = tooltipBox(950, 100, 200, 60, 1000, 800);
    expect(b.x + 200).toBeLessThanOrEqual(1000);
  });

  test("下端で上へ反転（はみ出さない）", () => {
    const b = tooltipBox(100, 780, 200, 60, 1000, 800);
    expect(b.y + 60).toBeLessThanOrEqual(800);
  });

  test("反転してもさらにはみ出す場合は最小マージンにクランプ", () => {
    const b = tooltipBox(5, 5, 200, 60, 1000, 800);
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.y).toBeGreaterThanOrEqual(0);
  });
});

describe("wrapLines", () => {
  // 1 文字 = 10px とみなす測定関数
  const measure = (s: string): number => s.length * 10;

  test("最大幅に収まる長文を複数行へ折り返す", () => {
    const lines = wrapLines("aaaa bbbb cccc dddd", 100, measure);
    // 各行は 100px(=10文字) 以内
    for (const ln of lines) expect(measure(ln)).toBeLessThanOrEqual(100);
    expect(lines.length).toBeGreaterThan(1);
  });

  test("短文は 1 行のまま", () => {
    expect(wrapLines("short", 100, measure)).toEqual(["short"]);
  });

  test("空文字は空配列", () => {
    expect(wrapLines("", 100, measure)).toEqual([]);
  });

  test("空白の無い長文（日本語想定）も文字単位で折り返し各行が幅以内", () => {
    // 25 文字の空白なし文字列を maxWidth=100(=10文字) で折り返す
    const cjkLike = "あいうえおかきくけこさしすせそたちつてとなにぬねの";
    const lines = wrapLines(cjkLike, 100, measure);
    for (const ln of lines) expect(measure(ln)).toBeLessThanOrEqual(100);
    expect(lines.length).toBeGreaterThan(1);
    // 文字が欠落・重複していないこと
    expect(lines.join("")).toBe(cjkLike);
  });

  test("折り返した行に空白を含む語が混在しても各行が幅以内", () => {
    const lines = wrapLines("abc あいうえおかきくけこさしすせそ xyz", 100, measure);
    for (const ln of lines) expect(measure(ln)).toBeLessThanOrEqual(100);
  });
});

describe("nodeMenuTooltipContent (#203 ノード追加メニューのツールチップ)", () => {
  const def: NodeTypeDef = {
    type: "Add",
    description: "2 入力を足す",
    inputs: [
      { id: "a", label: "a", type: "number" },
      { id: "b", label: "b", type: "number" },
    ],
    outputs: [{ id: "out", label: "a+b", type: "number" }],
    params: [],
    evaluate: () => ({}),
  };

  test("description と入出力ポート（label:type）を返す", () => {
    const c = nodeMenuTooltipContent(def);
    expect(c?.title).toBe("Add");
    expect(c?.body).toBe("2 入力を足す");
    expect(c?.ports).toBe("in a:number, b:number   out a+b:number");
  });

  test("def が undefined なら null", () => {
    expect(nodeMenuTooltipContent(undefined)).toBeNull();
  });

  test("description が無くてもポートがあれば返す（body は空）", () => {
    const noDesc: NodeTypeDef = {
      type: "Cam", inputs: [], outputs: [{ id: "tex", label: "tex", type: "texture" }],
      params: [], evaluate: () => ({}),
    };
    const c = nodeMenuTooltipContent(noDesc);
    expect(c?.body).toBe("");
    expect(c?.ports).toBe("out tex:texture");
  });

  test("description もポートも無ければ null", () => {
    const empty: NodeTypeDef = { type: "X", inputs: [], outputs: [], params: [], evaluate: () => ({}) };
    expect(nodeMenuTooltipContent(empty)).toBeNull();
  });
});
