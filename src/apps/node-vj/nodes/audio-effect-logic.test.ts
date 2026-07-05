import { expect, test, describe } from "bun:test";
import {
  FILTER_TYPES,
  REVERB_DECAY_MAX,
  REVERB_DECAY_MIN,
  SMOOTH_TIME_CONSTANT,
  applySmoothParam,
  buildImpulseResponse,
  readFilterType,
  readNumberParam,
} from "./audio-effect-logic";

/** 決定的な擬似乱数（テスト再現性用）。 */
function seededRng(seed = 1): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe("readNumberParam (#239)", () => {
  test("範囲内はそのまま", () => {
    expect(readNumberParam(1000, 20, 20000, 500)).toBe(1000);
  });
  test("範囲外はクランプ", () => {
    expect(readNumberParam(-5, 20, 20000, 500)).toBe(20);
    expect(readNumberParam(99999, 20, 20000, 500)).toBe(20000);
  });
  test("非数（undefined/NaN/文字列）は fallback", () => {
    expect(readNumberParam(undefined, 0, 2, 1)).toBe(1);
    expect(readNumberParam(Number.NaN, 0, 2, 1)).toBe(1);
    expect(readNumberParam("abc", 0, 2, 1)).toBe(1);
  });
  test("数値文字列は数値として読む", () => {
    expect(readNumberParam("0.5", 0, 2, 1)).toBe(0.5);
  });
});

describe("readFilterType (#239)", () => {
  test("有効値はそのまま", () => {
    for (const t of FILTER_TYPES) expect(readFilterType(t)).toBe(t);
  });
  test("未知値・非文字列は lowpass にフォールバック", () => {
    expect(readFilterType("notch")).toBe("lowpass");
    expect(readFilterType(undefined)).toBe("lowpass");
    expect(readFilterType(42)).toBe("lowpass");
  });
});

describe("buildImpulseResponse (#239)", () => {
  test("長さ = sampleRate × decay・チャンネル数どおり", () => {
    const ir = buildImpulseResponse(48000, 2, 2, seededRng());
    expect(ir.length).toBe(2);
    expect(ir[0]!.length).toBe(96000);
    expect(ir[1]!.length).toBe(96000);
  });
  test("decay は 0.1〜8 秒にクランプ", () => {
    expect(buildImpulseResponse(1000, 100, 1, seededRng())[0]!.length).toBe(1000 * REVERB_DECAY_MAX);
    expect(buildImpulseResponse(1000, 0.001, 1, seededRng())[0]!.length).toBe(1000 * REVERB_DECAY_MIN);
  });
  test("全サンプルが [-1, 1] に収まる", () => {
    const [data] = buildImpulseResponse(8000, 0.5, 1, seededRng());
    for (const v of data!) {
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
  test("減衰する（前半の RMS > 後半の RMS・末尾はほぼ無音）", () => {
    const [data] = buildImpulseResponse(8000, 1, 1, seededRng());
    const rms = (arr: Float32Array): number => Math.sqrt(arr.reduce((s, v) => s + v * v, 0) / arr.length);
    const half = Math.floor(data!.length / 2);
    expect(rms(data!.subarray(0, half))).toBeGreaterThan(rms(data!.subarray(half)));
    expect(Math.abs(data![data!.length - 1]!)).toBeLessThan(0.01);
  });
  test("チャンネルごとに異なるノイズ（ステレオ感）", () => {
    const ir = buildImpulseResponse(8000, 0.2, 2, seededRng());
    expect(ir[0]).not.toEqual(ir[1]);
  });
});

describe("applySmoothParam (#239)", () => {
  const mockParam = () => {
    const calls: Array<{ v: number; t: number; tc: number }> = [];
    return { calls, setTargetAtTime(v: number, t: number, tc: number) { calls.push({ v, t, tc }); } };
  };

  test("初回（last=null）は setTargetAtTime を呼ぶ", () => {
    const p = mockParam();
    const last = applySmoothParam(p, null, 1000, 5);
    expect(last).toBe(1000);
    expect(p.calls).toEqual([{ v: 1000, t: 5, tc: SMOOTH_TIME_CONSTANT }]);
  });
  test("同じ値なら呼ばない（automation イベントを積まない）", () => {
    const p = mockParam();
    let last = applySmoothParam(p, null, 1000, 0);
    last = applySmoothParam(p, last, 1000, 1);
    expect(last).toBe(1000);
    expect(p.calls.length).toBe(1);
  });
  test("値が変わったら再度呼ぶ", () => {
    const p = mockParam();
    let last = applySmoothParam(p, null, 1000, 0);
    last = applySmoothParam(p, last, 2000, 1);
    expect(last).toBe(2000);
    expect(p.calls.length).toBe(2);
    expect(p.calls[1]).toEqual({ v: 2000, t: 1, tc: SMOOTH_TIME_CONSTANT });
  });
});
