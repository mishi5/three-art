import { expect, test, describe } from "bun:test";
import {
  NODE_WIDTH, TITLE_H, ROW_H, nodeHeight, inputPortPos, outputPortPos,
  portIndex, nodeRect, hasRandomRow, randomRowRect,
  hasTransportRow, transportRowRect,
  hasSceneRow, sceneRowRect, sceneRowLabel,
  hasPadGrid, padGridAccept, padGridMetrics, padGridHeight, padGridRect, padRect, padIndexAt,
  padExpandButtonRect, padStopButtonRect,
  PAD_MARGIN_X, PAD_MARGIN_TOP,
  hasTapRows, tapSeekRowRect, tapControlRowRect, tapControlLayout, tapStatusLabel,
  hasAutomationRows, automationSeekRowRect, automationControlRowRect, automationControlLayout,
  automationSeekFraction, automationStatusLabel,
  hasBeatClockRow, beatClockRowRect, beatClockRowLayout, beatClockStatusLabel,
  hasScreenOutputRow, screenOutputRowRect, screenOutputRowLayout, screenOutputStatusLabel,
  paramRowY,
  hasMidiLearnRow, midiLearnRowRect, midiLearnRowLayout, midiLearnStatusLabel,
  hasMidiPadGrid, midiPadGridMetrics, midiPadGridHeight, midiPadGridRect, midiPadRect,
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

  test("#281: transport 単体（fileInput なし）はトランスポート行 1 行ぶん増え、最下行に置かれる", () => {
    const tp: NodeTypeDef = {
      type: "TP", inputs: [], outputs: [{ id: "o", label: "o", type: "texture" }],
      params: [], transport: true, evaluate: () => ({}),
    };
    expect(hasTransportRow(tp)).toBe(true);
    expect(hasTransportRow(def)).toBe(false);
    // portRows=1（出力1）, params=0 → transport +1 行
    expect(nodeHeight(tp)).toBe(TITLE_H + 1 * ROW_H + ROW_H + 8);
    const tr = transportRowRect(node, tp)!;
    expect(tr).toEqual({ x: 100, y: 50 + nodeHeight(tp) - ROW_H, w: NODE_WIDTH, h: ROW_H });
    expect(transportRowRect(node, def)).toBeNull();
    // fileInput 持ちは従来どおり（transport フラグなしでも行が出る・高さ FILE_ROWS のまま）。
    const fi: NodeTypeDef = { ...tp, transport: undefined, fileInput: { accept: "video/*" } };
    expect(hasTransportRow(fi)).toBe(true);
    expect(nodeHeight(fi)).toBe(TITLE_H + 1 * ROW_H + 2 * ROW_H + 8);
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

  test("#281 padGridAccept: accept 指定を返し、省略時は audio/*（SamplePad 従来動作）", () => {
    expect(padGridAccept(padDef)).toBe("audio/*");
    const clipDef: NodeTypeDef = {
      ...padDef, type: "ClipLauncher",
      padGrid: { rows: 4, cols: 4, accept: "video/*,image/*" },
    };
    expect(padGridAccept(clipDef)).toBe("video/*,image/*");
    expect(padGridAccept(def)).toBe("audio/*"); // padGrid 無しも既定値
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

describe("#204/#278 TapSequencer layout", () => {
  // reset (trigger) 入力・trigger 出力・loopMode/speed の 2 可視 param・tapSequencer フラグ
  // （#278 で Automation とレイアウトを統一した実ノードの形に合わせる）。
  const tapDef: NodeTypeDef = {
    type: "TapSequencer", category: "control",
    inputs: [{ id: "reset", label: "reset", type: "trigger" }],
    outputs: [{ id: "trigger", label: "trig", type: "trigger" }],
    params: [
      { id: "loopMode", label: "loopMode", kind: "enum", default: "loop", options: ["once", "loop"] },
      { id: "speed", label: "speed", kind: "number", default: 1 },
    ],
    tapSequencer: true, evaluate: () => ({}),
  };
  const tapNode: NodeInstance = { id: "t", type: "TapSequencer", params: {}, position: { x: 100, y: 50 } };

  test("hasTapRows 判定", () => {
    expect(hasTapRows(tapDef)).toBe(true);
    expect(hasTapRows(def)).toBe(false);
  });

  test("nodeHeight はシークバー行＋コントロール行の 2 行ぶん増える", () => {
    // portRows = max(1 signal入力, 1 出力) = 1・可視 param = 2 → base + 2 行
    const base = TITLE_H + 1 * ROW_H + 2 * ROW_H + 8;
    expect(nodeHeight(tapDef)).toBe(base + 2 * ROW_H);
  });

  test("シークバー行は params 直下・コントロール行はその下（tapSequencer 無しは null）", () => {
    const sr = tapSeekRowRect(tapNode, tapDef)!;
    expect(sr).toEqual({ x: 100, y: 50 + TITLE_H + 1 * ROW_H + 2 * ROW_H, w: NODE_WIDTH, h: ROW_H });
    const cr = tapControlRowRect(tapNode, tapDef)!;
    expect(cr).toEqual({ x: 100, y: sr.y + ROW_H, w: NODE_WIDTH, h: ROW_H });
    expect(tapSeekRowRect(tapNode, def)).toBeNull();
    expect(tapControlRowRect(tapNode, def)).toBeNull();
  });

  test("tapControlLayout: #278 停止/再生・クリア・ステータスの3分割が行内に収まり重ならない", () => {
    const cr = tapControlRowRect(tapNode, tapDef)!;
    const { stopPlay, clear, status } = tapControlLayout(cr);
    expect(stopPlay.x).toBeGreaterThanOrEqual(cr.x);
    expect(stopPlay.x + stopPlay.w).toBeLessThanOrEqual(clear.x);
    expect(clear.x + clear.w).toBeLessThanOrEqual(status.x);
    expect(status.x + status.w).toBeLessThanOrEqual(cr.x + cr.w);
    expect(stopPlay.y).toBeGreaterThanOrEqual(cr.y);
    expect(stopPlay.y + stopPlay.h).toBeLessThanOrEqual(cr.y + cr.h);
    expect(status.y + status.h).toBeLessThanOrEqual(cr.y + cr.h);
  });

  test("tapStatusLabel: フェーズごとの表示", () => {
    expect(tapStatusLabel(undefined)).toBe("記録なし");
    expect(tapStatusLabel({ phase: "idle", tapCount: 0, loopLenSec: 0, playPosSec: 0, recordElapsedSec: 0 }))
      .toBe("記録なし");
    expect(tapStatusLabel({ phase: "recording", tapCount: 3, loopLenSec: 0, playPosSec: 0, recordElapsedSec: 1.23 }))
      .toBe("録音中 3打 1.2s");
    expect(tapStatusLabel({ phase: "playing", tapCount: 4, loopLenSec: 2.5, playPosSec: 0.78, recordElapsedSec: 0 }))
      .toBe("4打 / 2.5s ループ ▶0.8s");
    expect(tapStatusLabel({ phase: "stopped", tapCount: 4, loopLenSec: 2.5, playPosSec: 0.78, recordElapsedSec: 0 }))
      .toBe("■ 停止中 4打 / 2.5s ⏸0.8s");
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

  test("automationControlLayout: 停止/再生・クリア・ステータス表示の3分割が行内に収まり重ならない", () => {
    const cr = automationControlRowRect(autoNode, autoDef)!;
    const { stopPlay, clear, status } = automationControlLayout(cr);
    expect(stopPlay.x).toBeGreaterThanOrEqual(cr.x);
    expect(stopPlay.x + stopPlay.w).toBeLessThanOrEqual(clear.x);
    expect(clear.x + clear.w).toBeLessThanOrEqual(status.x);
    expect(status.x + status.w).toBeLessThanOrEqual(cr.x + cr.w);
    expect(stopPlay.y).toBeGreaterThanOrEqual(cr.y);
    expect(stopPlay.y + stopPlay.h).toBeLessThanOrEqual(cr.y + cr.h);
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
    expect(automationStatusLabel({ phase: "stopped", frameCount: 20, loopLenSec: 2.5, playPosSec: 0.78, recordElapsedSec: 0 }))
      .toBe("■ 停止中 2.5s ⏸0.8s");
  });
});

describe("#270 BeatClock layout", () => {
  // tap/onset (trigger) 入力・bpm/beats/phase/beat/div の 5 出力・bpm/division の 2 可視 param・
  // beatClock フラグ（実ノードの形に合わせる）。
  const bcDef: NodeTypeDef = {
    type: "BeatClock", category: "control",
    inputs: [
      { id: "tap", label: "tap", type: "trigger" },
      { id: "onset", label: "onset", type: "trigger" },
    ],
    outputs: [
      { id: "bpm", label: "bpm", type: "number" },
      { id: "beats", label: "beats", type: "number" },
      { id: "phase", label: "phase", type: "number" },
      { id: "beat", label: "beat", type: "trigger" },
      { id: "div", label: "div", type: "trigger" },
    ],
    params: [
      { id: "bpm", label: "bpm", kind: "number", default: 120 },
      { id: "division", label: "division", kind: "enum", default: "1", options: ["1/4", "1/2", "1", "2", "4", "8"] },
    ],
    beatClock: true, evaluate: () => ({}),
  };
  const bcNode: NodeInstance = { id: "b", type: "BeatClock", params: {}, position: { x: 100, y: 50 } };

  test("hasBeatClockRow 判定", () => {
    expect(hasBeatClockRow(bcDef)).toBe(true);
    expect(hasBeatClockRow(def)).toBe(false);
  });

  test("nodeHeight は TAP/ステータス行の 1 行ぶん増える", () => {
    // portRows = max(2 signal入力, 5 出力) = 5・可視 param = 2 → base + 1 行
    const base = TITLE_H + 5 * ROW_H + 2 * ROW_H + 8;
    expect(nodeHeight(bcDef)).toBe(base + 1 * ROW_H);
  });

  test("beatClockRowRect は params 直下（beatClock 無しは null）", () => {
    const br = beatClockRowRect(bcNode, bcDef)!;
    expect(br).toEqual({ x: 100, y: 50 + TITLE_H + 5 * ROW_H + 2 * ROW_H, w: NODE_WIDTH, h: ROW_H });
    expect(beatClockRowRect(bcNode, def)).toBeNull();
  });

  test("beatClockRowLayout: TAP ボタンとステータスが行内に収まり重ならない", () => {
    const br = beatClockRowRect(bcNode, bcDef)!;
    const { tap, status } = beatClockRowLayout(br);
    expect(tap.w).toBe(54);
    expect(tap.x).toBeGreaterThanOrEqual(br.x);
    expect(tap.x + tap.w).toBeLessThanOrEqual(status.x);
    expect(status.x + status.w).toBeLessThanOrEqual(br.x + br.w);
    expect(tap.y).toBeGreaterThanOrEqual(br.y);
    expect(tap.y + tap.h).toBeLessThanOrEqual(br.y + br.h);
    expect(status.y + status.h).toBeLessThanOrEqual(br.y + br.h);
  });

  test("beatClockStatusLabel: BPM 表示・state 未生成は既定文言", () => {
    expect(beatClockStatusLabel(null)).toBe("BPM --");
    expect(beatClockStatusLabel(undefined)).toBe("BPM --");
    expect(beatClockStatusLabel({ bpm: 120.04, phase: 0.5, tapActive: false })).toBe("120.0 BPM");
    expect(beatClockStatusLabel({ bpm: 98.25, phase: 0, tapActive: true })).toBe("98.3 BPM");
  });
});

describe("#227 CATEGORY_COLORS", () => {
  test("7 カテゴリ（NODE_CATEGORIES）すべてに色が定義されている", () => {
    for (const cat of NODE_CATEGORIES) {
      expect(CATEGORY_COLORS[cat]).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe("#282 Screen 出力トグル行 layout", () => {
  // 実 Screen ノードの形: texture 入力 1・出力 0・可視 param 8（ワープ 4 隅）・screenOutput フラグ。
  const soDef: NodeTypeDef = {
    type: "Screen", category: "output",
    inputs: [{ id: "texture", label: "tex", type: "texture" }],
    outputs: [],
    params: [
      { id: "tlX", label: "tl.x", kind: "number", default: 0, noInput: true },
      { id: "tlY", label: "tl.y", kind: "number", default: 0, noInput: true },
      { id: "trX", label: "tr.x", kind: "number", default: 1, noInput: true },
      { id: "trY", label: "tr.y", kind: "number", default: 0, noInput: true },
      { id: "blX", label: "bl.x", kind: "number", default: 0, noInput: true },
      { id: "blY", label: "bl.y", kind: "number", default: 1, noInput: true },
      { id: "brX", label: "br.x", kind: "number", default: 1, noInput: true },
      { id: "brY", label: "br.y", kind: "number", default: 1, noInput: true },
    ],
    isSink: true, screenOutput: true, evaluate: () => ({}),
  };
  const soNode: NodeInstance = { id: "s", type: "Screen", params: {}, position: { x: 100, y: 50 } };

  test("hasScreenOutputRow 判定", () => {
    expect(hasScreenOutputRow(soDef)).toBe(true);
    expect(hasScreenOutputRow(def)).toBe(false);
  });

  test("nodeHeight はトグル行の 1 行ぶん増える", () => {
    // portRows = max(1 texture入力, 0 出力) = 1・可視 param = 8 → base + 1 行
    const base = TITLE_H + 1 * ROW_H + 8 * ROW_H + 8;
    expect(nodeHeight(soDef)).toBe(base + 1 * ROW_H);
  });

  test("screenOutputRowRect は params 直下（screenOutput 無しは null）", () => {
    const sr = screenOutputRowRect(soNode, soDef)!;
    expect(sr).toEqual({ x: 100, y: 50 + TITLE_H + 1 * ROW_H + 8 * ROW_H, w: NODE_WIDTH, h: ROW_H });
    expect(screenOutputRowRect(soNode, def)).toBeNull();
  });

  test("screenOutputRowLayout: トグルボタンと状態ラベルが行内に収まり重ならない", () => {
    const sr = screenOutputRowRect(soNode, soDef)!;
    const { button, status } = screenOutputRowLayout(sr);
    expect(button.x).toBeGreaterThanOrEqual(sr.x);
    expect(button.x + button.w).toBeLessThanOrEqual(status.x);
    expect(status.x + status.w).toBeLessThanOrEqual(sr.x + sr.w);
    expect(button.y).toBeGreaterThanOrEqual(sr.y);
    expect(button.y + button.h).toBeLessThanOrEqual(sr.y + sr.h);
    expect(status.y + status.h).toBeLessThanOrEqual(sr.y + sr.h);
  });

  test("screenOutputStatusLabel: 開いている間は出力中・それ以外は未出力", () => {
    expect(screenOutputStatusLabel(true)).toBe("出力中");
    expect(screenOutputStatusLabel(false)).toBe("未出力");
  });
});

describe("#272 MIDI Learn 行", () => {
  const learnDef: NodeTypeDef = {
    type: "MidiCCLike",
    midiLearn: true,
    inputs: [],
    outputs: [{ id: "value", label: "value", type: "number" }],
    params: [{ id: "channel", label: "channel", kind: "int", default: 0, noInput: true }],
    evaluate: () => ({}),
  };
  const learnNode: NodeInstance = { id: "n", type: "MidiCCLike", params: {}, position: { x: 10, y: 20 } };

  test("midiLearn の有無で行の有無が決まる", () => {
    expect(hasMidiLearnRow(learnDef)).toBe(true);
    expect(hasMidiLearnRow(def)).toBe(false);
    expect(midiLearnRowRect(node, def)).toBeNull();
  });

  test("行のぶんだけノードが高くなる", () => {
    const withoutRow: NodeTypeDef = { ...learnDef, midiLearn: undefined };
    expect(nodeHeight(learnDef) - nodeHeight(withoutRow)).toBe(ROW_H);
  });

  test("行は params 直下に置かれる（幅はノード幅いっぱい）", () => {
    const r = midiLearnRowRect(learnNode, learnDef)!;
    // portRows=1（value 出力）, 表示 param=1（channel）。
    expect(r.y).toBe(20 + TITLE_H + 1 * ROW_H + 1 * ROW_H);
    expect(r.x).toBe(10);
    expect(r.w).toBe(NODE_WIDTH);
    expect(r.h).toBe(ROW_H);
  });

  test("行は LEARN ボタンとステータスに分割され、重ならず行内に収まる", () => {
    const r = midiLearnRowRect(learnNode, learnDef)!;
    const { learn, status } = midiLearnRowLayout(r);
    expect(learn.x).toBeGreaterThanOrEqual(r.x);
    expect(status.x).toBeGreaterThanOrEqual(learn.x + learn.w);
    expect(status.x + status.w).toBeLessThanOrEqual(r.x + r.w);
    expect(status.w).toBeGreaterThan(0);
  });
});

describe("#272 midiLearnStatusLabel", () => {
  const base = { waiting: false, status: "ready" as const, channel: 1, number: 74, kind: "cc" as const };

  test("待機中は接続状態や割当より優先して表示する", () => {
    expect(midiLearnStatusLabel({ ...base, waiting: true })).toBe("操作待ち…");
    expect(midiLearnStatusLabel({ ...base, waiting: true, status: "no-device" })).toBe("操作待ち…");
  });

  test("接続に問題があるときは割当より先にそれを見せる", () => {
    expect(midiLearnStatusLabel({ ...base, status: "unsupported" })).toBe("MIDI 非対応");
    expect(midiLearnStatusLabel({ ...base, status: "denied" })).toBe("MIDI 権限なし");
    expect(midiLearnStatusLabel({ ...base, status: "no-device" })).toBe("デバイスなし");
    expect(midiLearnStatusLabel({ ...base, status: "starting" })).toBe("接続中…");
    expect(midiLearnStatusLabel({ ...base, status: "idle" })).toBe("接続中…");
  });

  test("接続できていれば割当内容を出す（channel 0 は omni）", () => {
    expect(midiLearnStatusLabel(base)).toBe("ch1 CC74");
    expect(midiLearnStatusLabel({ ...base, channel: 0 })).toBe("omni CC74");
    expect(midiLearnStatusLabel({ ...base, kind: "note", number: 36 })).toBe("ch1 note36");
  });

  test("state 未生成（null）でも落ちない", () => {
    expect(midiLearnStatusLabel(null)).toBe("接続中…");
  });
});

describe("#272 MidiPad 押下インジケータ", () => {
  const padDef: NodeTypeDef = {
    type: "MidiPadLike",
    midiLearn: true,
    midiPad: { rows: 4, cols: 4 },
    inputs: [],
    outputs: [{ id: "index", label: "index", type: "number" }],
    params: [{ id: "channel", label: "channel", kind: "int", default: 0, noInput: true }],
    evaluate: () => ({}),
  };
  const padNode: NodeInstance = { id: "n", type: "MidiPadLike", params: {}, position: { x: 0, y: 0 } };

  test("midiPad の有無でグリッドの有無が決まる", () => {
    expect(hasMidiPadGrid(padDef)).toBe(true);
    expect(hasMidiPadGrid(def)).toBe(false);
    expect(midiPadGridMetrics(def)).toBeNull();
    expect(midiPadGridHeight(def)).toBe(0);
    expect(midiPadRect(node, def, 0)).toBeNull();
  });

  test("4×4 の正方マスがノード幅に収まる", () => {
    const m = midiPadGridMetrics(padDef)!;
    expect(m.rows).toBe(4);
    expect(m.cols).toBe(4);
    expect(m.padW).toBe(m.padH);
    expect(m.innerW).toBe(NODE_WIDTH - 2 * PAD_MARGIN_X);
    expect(m.cols * m.padW + (m.cols - 1) * m.gap).toBeCloseTo(m.innerW);
  });

  test("グリッドは MIDI Learn 行の下に置かれる（行と重ならない）", () => {
    const learnRow = midiLearnRowRect(padNode, padDef)!;
    const grid = midiPadGridRect(padNode, padDef)!;
    expect(grid.y).toBe(learnRow.y + ROW_H + PAD_MARGIN_TOP);
    expect(grid.x).toBe(PAD_MARGIN_X);
  });

  test("マスは左上から行優先で並び、範囲外は null", () => {
    const grid = midiPadGridRect(padNode, padDef)!;
    const m = midiPadGridMetrics(padDef)!;
    const p0 = midiPadRect(padNode, padDef, 0)!;
    expect(p0.x).toBe(grid.x);
    expect(p0.y).toBe(grid.y);
    const p4 = midiPadRect(padNode, padDef, 4)!; // 2 行目の先頭
    expect(p4.x).toBe(grid.x);
    expect(p4.y).toBeCloseTo(grid.y + m.padH + m.gap);
    const p15 = midiPadRect(padNode, padDef, 15)!;
    expect(p15.x + p15.w).toBeCloseTo(grid.x + grid.w);
    expect(midiPadRect(padNode, padDef, 16)).toBeNull();
    expect(midiPadRect(padNode, padDef, -1)).toBeNull();
  });

  test("ノード高さに Learn 行とグリッドの両方が含まれる", () => {
    const plain: NodeTypeDef = { ...padDef, midiLearn: undefined, midiPad: undefined };
    expect(nodeHeight(padDef) - nodeHeight(plain))
      .toBeCloseTo(ROW_H + PAD_MARGIN_TOP + midiPadGridHeight(padDef));
  });

  test("グリッドがノード下端からはみ出さない", () => {
    const grid = midiPadGridRect(padNode, padDef)!;
    expect(grid.y + grid.h).toBeLessThanOrEqual(nodeHeight(padDef));
  });
});

describe("#293 hidden param が先頭・中間にあっても行がずれない", () => {
  // SceneInput と同じ形: 先頭に hidden param、その後ろに表示 param が続く。
  const leadingHiddenDef: NodeTypeDef = {
    type: "LeadingHidden",
    sceneInput: true,
    inputs: [],
    outputs: [{ id: "texture", label: "tex", type: "texture" }],
    params: [
      { id: "sceneId", label: "scene", kind: "string", default: "", hidden: true },
      { id: "a", label: "a", kind: "number", default: 0, min: 0, max: 1 },
      { id: "b", label: "b", kind: "number", default: 0, min: 0, max: 1 },
    ],
    evaluate: () => ({}),
  };
  const n: NodeInstance = { id: "n", type: "LeadingHidden", params: {}, position: { x: 0, y: 0 } };

  test("表示 param は hidden を詰めた位置に来る（先頭に空行を作らない）", () => {
    const top = TITLE_H + 1 * ROW_H; // portRows=1（texture 出力）
    // params[1] が最初の表示行、params[2] が 2 行目。
    expect(paramRowY(n, leadingHiddenDef, 1)).toBe(top + 0 * ROW_H + ROW_H / 2);
    expect(paramRowY(n, leadingHiddenDef, 2)).toBe(top + 1 * ROW_H + ROW_H / 2);
  });

  test("param 行の下に来る行（シーン行）が最後の param 行と重ならない", () => {
    // ここが崩れると、シーン行のクリックが param スライダのドラッグに食われる。
    const lastParamY = paramRowY(n, leadingHiddenDef, 2);
    const scene = sceneRowRect(n, leadingHiddenDef)!;
    expect(scene.y).toBeGreaterThanOrEqual(lastParamY + ROW_H / 2);
  });

  test("すべての行がノード高さに収まる", () => {
    const scene = sceneRowRect(n, leadingHiddenDef)!;
    expect(scene.y + scene.h).toBeLessThanOrEqual(nodeHeight(leadingHiddenDef));
  });

  test("hidden が末尾のノード（従来ケース）は挙動が変わらない", () => {
    const trailingHiddenDef: NodeTypeDef = {
      type: "TrailingHidden",
      inputs: [],
      outputs: [{ id: "o", label: "o", type: "number" }],
      params: [
        { id: "a", label: "a", kind: "number", default: 0 },
        { id: "assetId", label: "assetId", kind: "string", default: "", hidden: true },
      ],
      evaluate: () => ({}),
    };
    const t: NodeInstance = { id: "t", type: "TrailingHidden", params: {}, position: { x: 0, y: 0 } };
    expect(paramRowY(t, trailingHiddenDef, 0)).toBe(TITLE_H + 1 * ROW_H + ROW_H / 2);
  });
});
