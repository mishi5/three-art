import { expect, test, describe } from "bun:test";
import {
  graphMaxSamples,
  pushSample,
  valueToY,
  computeGraphPoints,
  type GraphSample,
} from "./graph-visual-logic";

describe("graphMaxSamples", () => {
  test("maxWindowSec × fps の切り上げ", () => {
    expect(graphMaxSamples(30, 60)).toBe(1800);
    expect(graphMaxSamples(4, 30)).toBe(120);
  });
  test("最低 1 を返す", () => {
    expect(graphMaxSamples(0, 0)).toBe(1);
  });
});

describe("pushSample（リングバッファ）", () => {
  test("push で末尾に追加される", () => {
    const buf: GraphSample[] = [];
    pushSample(buf, 0, 0.5, 10);
    pushSample(buf, 1, -0.5, 10);
    expect(buf).toEqual([{ t: 0, v: 0.5 }, { t: 1, v: -0.5 }]);
  });

  test("上限超過は古い方から捨てる", () => {
    const buf: GraphSample[] = [];
    for (let i = 0; i < 5; i++) pushSample(buf, i, i, 3);
    expect(buf.length).toBe(3);
    expect(buf.map((s) => s.t)).toEqual([2, 3, 4]); // 最新 3 件
  });

  test("非有限値（NaN/Infinity）は 0 に丸める", () => {
    const buf: GraphSample[] = [];
    pushSample(buf, 0, NaN, 10);
    pushSample(buf, 1, Infinity, 10);
    expect(buf).toEqual([{ t: 0, v: 0 }, { t: 1, v: 0 }]);
  });
});

describe("valueToY（縦マッピング）", () => {
  const H = 100;
  test("yMax は上端(0)、yMin は下端(height)", () => {
    expect(valueToY(1, -1, 1, H)).toBeCloseTo(0, 6);
    expect(valueToY(-1, -1, 1, H)).toBeCloseTo(H, 6);
  });
  test("中央値は中央", () => {
    expect(valueToY(0, -1, 1, H)).toBeCloseTo(50, 6);
  });
  test("範囲外は上下端にクランプ", () => {
    expect(valueToY(5, -1, 1, H)).toBeCloseTo(0, 6); // 上端
    expect(valueToY(-5, -1, 1, H)).toBeCloseTo(H, 6); // 下端
  });
  test("yMin===yMax の退化時は中央", () => {
    expect(valueToY(3, 2, 2, H)).toBeCloseTo(50, 6);
  });
  test("非対称レンジでも線形", () => {
    // yMin=0, yMax=10 で value=2.5 → norm 0.25 → y = 0.75*H
    expect(valueToY(2.5, 0, 10, H)).toBeCloseTo(75, 6);
  });
});

describe("computeGraphPoints（横スクロール・右端最新）", () => {
  const base = { windowSec: 4, yMin: -1, yMax: 1, timeSec: 10, width: 200, height: 100 };

  test("最新サンプルは右端、windowSec 前は左端", () => {
    const samples: GraphSample[] = [
      { t: 6, v: 0 }, // age=4（左端）
      { t: 10, v: 0 }, // age=0（右端）
    ];
    const pts = computeGraphPoints(samples, base);
    expect(pts.length).toBe(2);
    expect(pts[0]!.x).toBeCloseTo(0, 6);
    expect(pts[1]!.x).toBeCloseTo(200, 6);
  });

  test("窓の中間は比例配置", () => {
    const samples: GraphSample[] = [{ t: 8, v: 0 }]; // age=2 → 中央
    const pts = computeGraphPoints(samples, base);
    expect(pts[0]!.x).toBeCloseTo(100, 6);
  });

  test("windowSec より古いサンプルは除外", () => {
    const samples: GraphSample[] = [
      { t: 5, v: 0 }, // age=5 > 4 → 除外
      { t: 7, v: 0 }, // age=3 → 含む
    ];
    const pts = computeGraphPoints(samples, base);
    expect(pts.length).toBe(1);
  });

  test("未来のサンプル（age<0）は除外", () => {
    const samples: GraphSample[] = [{ t: 12, v: 0 }];
    expect(computeGraphPoints(samples, base).length).toBe(0);
  });

  test("空/未接続時は空配列（破綻しない）", () => {
    expect(computeGraphPoints([], base)).toEqual([]);
  });

  test("範囲外の値は Y がクランプされる", () => {
    const samples: GraphSample[] = [{ t: 10, v: 999 }];
    const pts = computeGraphPoints(samples, base);
    expect(pts[0]!.y).toBeCloseTo(0, 6); // 上端クランプ
  });

  test("windowSec を変えると横スケールが変化する", () => {
    const samples: GraphSample[] = [{ t: 8, v: 0 }]; // age=2
    const wide = computeGraphPoints(samples, { ...base, windowSec: 8 }); // age/win=0.25 → x=150
    expect(wide[0]!.x).toBeCloseTo(150, 6);
    const narrow = computeGraphPoints(samples, { ...base, windowSec: 2 }); // age/win=1 → x=0
    expect(narrow[0]!.x).toBeCloseTo(0, 6);
  });

  test("windowSec=0 でも例外を投げない", () => {
    expect(() => computeGraphPoints([{ t: 10, v: 0 }], { ...base, windowSec: 0 })).not.toThrow();
  });
});
