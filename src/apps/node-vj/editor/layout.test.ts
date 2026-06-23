import { expect, test, describe } from "bun:test";
import {
  NODE_WIDTH, TITLE_H, ROW_H, nodeHeight, inputPortPos, outputPortPos,
  portIndex, nodeRect, hasRandomRow, randomRowRect,
  hasSceneRow, sceneRowRect, sceneRowLabel,
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
