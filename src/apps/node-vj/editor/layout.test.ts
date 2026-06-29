import { expect, test, describe } from "bun:test";
import {
  NODE_WIDTH, TITLE_H, ROW_H, nodeHeight, inputPortPos, outputPortPos,
  portIndex, nodeRect, hasRandomRow, randomRowRect,
  hasSceneRow, sceneRowRect, sceneRowLabel,
  hasPadGrid, padGridMetrics, padGridHeight, padGridRect, padRect, padIndexAt,
  PAD_MARGIN_X, PAD_MARGIN_TOP,
} from "./layout";
import type { NodeTypeDef } from "../graph/node-type";
import type { NodeInstance } from "../graph/graph-doc";

const def: NodeTypeDef = {
  type: "T",
  inputs: [{ id: "a", label: "a", type: "number" }, { id: "b", label: "b", type: "number" }],
  outputs: [{ id: "o", label: "o", type: "number" }],
  params: [{ id: "p", label: "p", kind: "number", default: 0 }],
  evaluate: () => ({}),
};

const node: NodeInstance = { id: "n", type: "T", params: {}, position: { x: 100, y: 50 } };

describe("editor layout", () => {
  test("nodeHeight は title + max(行) + params", () => {
    // portRows=2, params=1
    expect(nodeHeight(def)).toBe(TITLE_H + 2 * ROW_H + 1 * ROW_H + 8);
  });

  test("入力ポートは左辺、出力ポートは右辺", () => {
    expect(inputPortPos(node, 0).x).toBe(100);
    expect(outputPortPos(node, 0).x).toBe(100 + NODE_WIDTH);
  });

  test("ポート y はインデックスで段階的に下がる", () => {
    const y0 = inputPortPos(node, 0).y;
    const y1 = inputPortPos(node, 1).y;
    expect(y1 - y0).toBe(ROW_H);
  });

  test("portIndex", () => {
    expect(portIndex(def, "input", "b")).toBe(1);
    expect(portIndex(def, "output", "o")).toBe(0);
    expect(portIndex(def, "input", "zzz")).toBe(-1);
  });

  test("nodeRect は position と幅高さ", () => {
    const r = nodeRect(node, def);
    expect(r).toEqual({ x: 100, y: 50, w: NODE_WIDTH, h: nodeHeight(def) });
  });

  test("randomButton 持ちは行が1つ増え、ボタン行は params 直下に置かれる（#150）", () => {
    const rnd: NodeTypeDef = {
      type: "R", inputs: [], outputs: [{ id: "o", label: "o", type: "number" }],
      params: [{ id: "value", label: "v", kind: "number", default: 1 }],
      randomButton: { paramId: "value" }, evaluate: () => ({}),
    };
    expect(hasRandomRow(rnd)).toBe(true);
    expect(hasRandomRow(def)).toBe(false);
    // portRows=1（出力1）, params=1 → +1 行
    expect(nodeHeight(rnd)).toBe(TITLE_H + 1 * ROW_H + 1 * ROW_H + ROW_H + 8);
    const rr = randomRowRect(node, rnd)!;
    expect(rr).toEqual({ x: 100, y: 50 + TITLE_H + 1 * ROW_H + 1 * ROW_H, w: NODE_WIDTH, h: ROW_H });
    expect(randomRowRect(node, def)).toBeNull();
  });

  test("#152 sceneInput ノードは scene 行を持ち高さが 1 行ぶん増える", () => {
    const sceneDef: NodeTypeDef = {
      type: "S", inputs: [], outputs: [{ id: "texture", label: "t", type: "texture" }], params: [], sceneInput: true,
    } as unknown as NodeTypeDef;
    expect(hasSceneRow(sceneDef)).toBe(true);
    expect(hasSceneRow(def)).toBe(false);
    const sn: NodeInstance = { id: "n", type: "S", params: {}, position: { x: 10, y: 20 } };
    // portRows = max(0 signal入力, 1 出力) = 1、params=0 → scene 行は params 直下
    const r = sceneRowRect(sn, sceneDef)!;
    expect(r).toEqual({ x: 10, y: 20 + TITLE_H + 1 * ROW_H, w: NODE_WIDTH, h: ROW_H });
    expect(sceneRowRect(sn, def)).toBeNull();
  });

  test("#152 sceneRowLabel 未選択表示", () => {
    expect(sceneRowLabel(null)).toBe("(シーン未選択)");
    expect(sceneRowLabel("Intro")).toBe("Intro");
  });
});

describe("#205 padGrid layout", () => {
  // 4×4 グリッド・出力 audio・volume param のみ可視（padAssets は hidden）。
  const padDef: NodeTypeDef = {
    type: "MidiPad", category: "input",
    inputs: [], outputs: [{ id: "audio", label: "audio", type: "audio" }],
    params: [
      { id: "volume", label: "volume", kind: "number", default: 1 },
      { id: "padAssets", label: "padAssets", kind: "string", default: [], hidden: true, noInput: true },
    ],
    padGrid: { rows: 4, cols: 4 }, evaluate: () => ({}),
  };
  const padNode: NodeInstance = { id: "m", type: "MidiPad", params: {}, position: { x: 100, y: 50 } };

  test("hasPadGrid 判定", () => {
    expect(hasPadGrid(padDef)).toBe(true);
    expect(hasPadGrid(def)).toBe(false);
  });

  test("padGridMetrics: 4列はノード幅から正方形パッドを算出", () => {
    const m = padGridMetrics(padDef)!;
    expect(m.rows).toBe(4);
    expect(m.cols).toBe(4);
    expect(m.padW).toBe(m.padH); // 正方形
    // innerW = NODE_WIDTH - 2*margin、padW = (innerW - 3*gap)/4
    expect(m.innerW).toBe(NODE_WIDTH - 2 * PAD_MARGIN_X);
    expect(padGridMetrics(def)).toBeNull();
  });

  test("nodeHeight は padGrid 分（上マージン＋グリッド）増える", () => {
    // portRows=max(0,1)=1, 可視 param=1（volume のみ）
    const base = TITLE_H + 1 * ROW_H + 1 * ROW_H + 8;
    expect(nodeHeight(padDef)).toBe(base + PAD_MARGIN_TOP + padGridHeight(padDef));
  });

  test("padGridRect は params 直下・グリッドは index で row/col に並ぶ", () => {
    const grid = padGridRect(padNode, padDef)!;
    expect(grid.x).toBe(100 + PAD_MARGIN_X);
    expect(grid.y).toBe(50 + TITLE_H + 1 * ROW_H + 1 * ROW_H + PAD_MARGIN_TOP);
    // index 0 は左上、index 5 は (row1, col1)
    const p0 = padRect(padNode, padDef, 0)!;
    expect(p0.x).toBe(grid.x);
    expect(p0.y).toBe(grid.y);
    const m = padGridMetrics(padDef)!;
    const p5 = padRect(padNode, padDef, 5)!;
    expect(p5.x).toBeCloseTo(grid.x + 1 * (m.padW + m.gap));
    expect(p5.y).toBeCloseTo(grid.y + 1 * (m.padH + m.gap));
    // 範囲外は null
    expect(padRect(padNode, padDef, 16)).toBeNull();
    expect(padRect(padNode, padDef, -1)).toBeNull();
  });

  test("padIndexAt: パッド中心→index、ギャップ/範囲外→null", () => {
    for (const i of [0, 3, 5, 12, 15]) {
      const r = padRect(padNode, padDef, i)!;
      expect(padIndexAt(padNode, padDef, r.x + r.w / 2, r.y + r.h / 2)).toBe(i);
    }
    // グリッドの遥か外側
    expect(padIndexAt(padNode, padDef, 0, 0)).toBeNull();
    // パッド間のギャップ（index0 と index1 の隙間）
    const r0 = padRect(padNode, padDef, 0)!;
    const r1 = padRect(padNode, padDef, 1)!;
    const gapX = (r0.x + r0.w + r1.x) / 2;
    expect(padIndexAt(padNode, padDef, gapX, r0.y + r0.h / 2)).toBeNull();
    // padGrid を持たない def は常に null
    expect(padIndexAt(node, def, 100, 50)).toBeNull();
  });
});
