import { expect, test, describe } from "bun:test";
import {
  NODE_WIDTH, TITLE_H, ROW_H, nodeHeight, inputPortPos, outputPortPos,
  portIndex, nodeRect, hasRandomRow, randomRowRect,
  hasSceneRow, sceneRowRect, sceneRowLabel,
  hasPadGrid, padGridMetrics, padGridHeight, padGridRect, padRect, padIndexAt,
  padExpandButtonRect, padStopButtonRect,
  PAD_MARGIN_X, PAD_MARGIN_TOP,
  hasTapRows, tapControlRowRect, tapStatusRowRect, tapControlLayout, tapStatusLabel,
  hasAutomationRows, automationSeekRowRect, automationControlRowRect, automationControlLayout,
  automationSeekFraction, automationStatusLabel,
  CATEGORY_COLORS,
} from "./layout";
import { NODE_CATEGORIES, type NodeTypeDef } from "../graph/node-type";
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
    type: "SamplePad", category: "source",
    inputs: [], outputs: [{ id: "audio", label: "audio", type: "audio" }],
    params: [
      { id: "volume", label: "volume", kind: "number", default: 1 },
      { id: "padAssets", label: "padAssets", kind: "string", default: [], hidden: true, noInput: true },
    ],
    padGrid: { rows: 4, cols: 4 }, evaluate: () => ({}),
  };
  const padNode: NodeInstance = { id: "m", type: "SamplePad", params: {}, position: { x: 100, y: 50 } };

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

  test("拡大ボタンはタイトル右端・全停止ボタンはその左隣（重ならない）", () => {
    const eb = padExpandButtonRect(padNode);
    const sb = padStopButtonRect(padNode);
    // タイトルバー内（y は同じ高さ・グリッドより上）。
    expect(eb.y).toBe(50 + 4);
    expect(sb.y).toBe(50 + 4);
    // 拡大は右端寄り、全停止はその左。重ならない。
    expect(eb.x).toBeGreaterThan(sb.x);
    expect(sb.x + sb.w).toBeLessThanOrEqual(eb.x);
    expect(eb.x + eb.w).toBeLessThanOrEqual(100 + NODE_WIDTH);
  });
});

describe("#204 TapSequencer layout", () => {
  // 入力なし・trigger 出力 1・params なし・tapSequencer フラグ。
  const tapDef: NodeTypeDef = {
    type: "TapSequencer", category: "control",
    inputs: [], outputs: [{ id: "trigger", label: "trig", type: "trigger" }],
    params: [], tapSequencer: true, evaluate: () => ({}),
  };
  const tapNode: NodeInstance = { id: "t", type: "TapSequencer", params: {}, position: { x: 100, y: 50 } };

  test("hasTapRows 判定", () => {
    expect(hasTapRows(tapDef)).toBe(true);
    expect(hasTapRows(def)).toBe(false);
  });

  test("nodeHeight はコントロール行＋ステータス行の 2 行ぶん増える", () => {
    // portRows = max(0, 1) = 1・params = 0 → base + 2 行
    const base = TITLE_H + 1 * ROW_H + 8;
    expect(nodeHeight(tapDef)).toBe(base + 2 * ROW_H);
  });

  test("コントロール行は params 直下・ステータス行はその下（tapSequencer 無しは null）", () => {
    const cr = tapControlRowRect(tapNode, tapDef)!;
    expect(cr).toEqual({ x: 100, y: 50 + TITLE_H + 1 * ROW_H, w: NODE_WIDTH, h: ROW_H });
    const sr = tapStatusRowRect(tapNode, tapDef)!;
    expect(sr).toEqual({ x: 100, y: cr.y + ROW_H, w: NODE_WIDTH, h: ROW_H });
    expect(tapControlRowRect(node, def)).toBeNull();
    expect(tapStatusRowRect(node, def)).toBeNull();
  });

  test("tapControlLayout: 録音/クリアの 2 ボタンが行内に収まり重ならない", () => {
    const cr = tapControlRowRect(tapNode, tapDef)!;
    const { rec, clear } = tapControlLayout(cr);
    expect(rec.x).toBeGreaterThanOrEqual(cr.x);
    expect(rec.x + rec.w).toBeLessThanOrEqual(clear.x);
    expect(clear.x + clear.w).toBeLessThanOrEqual(cr.x + cr.w);
    expect(rec.y).toBeGreaterThanOrEqual(cr.y);
    expect(rec.y + rec.h).toBeLessThanOrEqual(cr.y + cr.h);
    expect(clear.y + clear.h).toBeLessThanOrEqual(cr.y + cr.h);
  });

  test("tapStatusLabel: フェーズごとの表示", () => {
    expect(tapStatusLabel(undefined)).toBe("記録なし");
    expect(tapStatusLabel({ phase: "idle", tapCount: 0, loopLenSec: 0, playPosSec: 0, recordElapsedSec: 0 }))
      .toBe("記録なし");
    expect(tapStatusLabel({ phase: "recording", tapCount: 3, loopLenSec: 0, playPosSec: 0, recordElapsedSec: 1.23 }))
      .toBe("録音中 3打 1.2s");
    expect(tapStatusLabel({ phase: "playing", tapCount: 4, loopLenSec: 2.5, playPosSec: 0.78, recordElapsedSec: 0 }))
      .toBe("4打 / 2.5s ループ ▶0.8s");
  });
});

describe("#186 Automation layout", () => {
  // reset (trigger) 入力・out (number) 出力・value/loopMode/speed の 3 可視 param・automation フラグ。
  const autoDef: NodeTypeDef = {
    type: "Automation", category: "control",
    inputs: [{ id: "reset", label: "reset", type: "trigger" }],
    outputs: [{ id: "out", label: "out", type: "number" }],
    params: [
      { id: "value", label: "value", kind: "number", default: 0 },
      { id: "loopMode", label: "loopMode", kind: "enum", default: "loop", options: ["once", "loop", "pingpong"] },
      { id: "speed", label: "speed", kind: "number", default: 1 },
    ],
    automation: true, evaluate: () => ({}),
  };
  const autoNode: NodeInstance = { id: "a", type: "Automation", params: {}, position: { x: 100, y: 50 } };

  test("hasAutomationRows 判定", () => {
    expect(hasAutomationRows(autoDef)).toBe(true);
    expect(hasAutomationRows(def)).toBe(false);
  });

  test("nodeHeight はシークバー行＋クリア/ステータス行の 2 行ぶん増える", () => {
    // portRows = max(1 signal入力, 1 出力) = 1・可視 param = 3 → base + 2 行
    const base = TITLE_H + 1 * ROW_H + 3 * ROW_H + 8;
    expect(nodeHeight(autoDef)).toBe(base + 2 * ROW_H);
  });

  test("シークバー行は params 直下・クリア/ステータス行はその下（automation 無しは null）", () => {
    const sr = automationSeekRowRect(autoNode, autoDef)!;
    expect(sr).toEqual({ x: 100, y: 50 + TITLE_H + 1 * ROW_H + 3 * ROW_H, w: NODE_WIDTH, h: ROW_H });
    const cr = automationControlRowRect(autoNode, autoDef)!;
    expect(cr).toEqual({ x: 100, y: sr.y + ROW_H, w: NODE_WIDTH, h: ROW_H });
    expect(automationSeekRowRect(autoNode, def)).toBeNull();
    expect(automationControlRowRect(autoNode, def)).toBeNull();
  });

  test("automationControlLayout: クリアボタンとステータス表示が行内に収まり重ならない", () => {
    const cr = automationControlRowRect(autoNode, autoDef)!;
    const { clear, status } = automationControlLayout(cr);
    expect(clear.x).toBeGreaterThanOrEqual(cr.x);
    expect(clear.x + clear.w).toBeLessThanOrEqual(status.x);
    expect(status.x + status.w).toBeLessThanOrEqual(cr.x + cr.w);
    expect(clear.y).toBeGreaterThanOrEqual(cr.y);
    expect(clear.y + clear.h).toBeLessThanOrEqual(cr.y + cr.h);
    expect(status.y + status.h).toBeLessThanOrEqual(cr.y + cr.h);
  });

  test("automationSeekFraction: rect 内の x 座標を 0..1 に変換しクランプする", () => {
    const rect = { x: 100, w: 100 };
    expect(automationSeekFraction(rect, 100)).toBeCloseTo(0);
    expect(automationSeekFraction(rect, 150)).toBeCloseTo(0.5);
    expect(automationSeekFraction(rect, 200)).toBeCloseTo(1);
    expect(automationSeekFraction(rect, 50)).toBe(0);   // 範囲外下方はクランプ
    expect(automationSeekFraction(rect, 250)).toBe(1);  // 範囲外上方はクランプ
  });

  test("automationSeekFraction: rect.w<=0 は 0", () => {
    expect(automationSeekFraction({ x: 0, w: 0 }, 10)).toBe(0);
    expect(automationSeekFraction({ x: 0, w: -5 }, 10)).toBe(0);
  });

  test("automationStatusLabel: フェーズごとの表示", () => {
    expect(automationStatusLabel(undefined)).toBe("記録なし");
    expect(automationStatusLabel({ phase: "idle", frameCount: 0, loopLenSec: 0, playPosSec: 0, recordElapsedSec: 0 }))
      .toBe("記録なし");
    expect(automationStatusLabel({ phase: "recording", frameCount: 12, loopLenSec: 0, playPosSec: 0, recordElapsedSec: 1.23 }))
      .toBe("録音中 12点 1.2s");
    expect(automationStatusLabel({ phase: "playing", frameCount: 20, loopLenSec: 2.5, playPosSec: 0.78, recordElapsedSec: 0 }))
      .toBe("2.5s ループ ▶0.8s");
  });
});

describe("#227 CATEGORY_COLORS", () => {
  test("7 カテゴリ（NODE_CATEGORIES）すべてに色が定義されている", () => {
    for (const cat of NODE_CATEGORIES) {
      expect(CATEGORY_COLORS[cat]).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});
