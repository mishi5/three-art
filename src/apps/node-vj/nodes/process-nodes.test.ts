import { expect, test, describe } from "bun:test";
import { SineNode } from "./SineNode";
import { NoiseNode } from "./NoiseNode";
import { AddNode } from "./AddNode";
import { RemapNode } from "./RemapNode";
import { SmoothNode, SmoothRuntime } from "./SmoothNode";
import type { EvalContext } from "../graph/node-type";

// fake ctx: inputs/params を Map で与える。
function ctx(opts: {
  inputs?: Record<string, unknown>;
  params?: Record<string, unknown>;
  timeSec?: number;
  state?: unknown;
}): EvalContext {
  return {
    timeSec: opts.timeSec ?? 0,
    input: (id) => opts.inputs?.[id],
    param: (id) => opts.params?.[id],
    node: { id: "n", type: "T", params: {} },
    state: opts.state,
  };
}

describe("SineNode", () => {
  test("freq·t に対する sin（t 未接続なら timeSec）", () => {
    // freq=0.25, t=1 → sin(2π·0.25·1)=sin(π/2)=1; amp=2, offset=3 → 5
    const out = SineNode.evaluate(ctx({ timeSec: 1, params: { freq: 0.25, amplitude: 2, offset: 3 } }));
    expect(out.out as number).toBeCloseTo(5, 6);
  });
  test("t 入力が timeSec を上書き", () => {
    const out = SineNode.evaluate(ctx({ timeSec: 99, inputs: { t: 0 }, params: { freq: 1, amplitude: 1, offset: 0 } }));
    expect(out.out as number).toBeCloseTo(0, 6);
  });
});

describe("NoiseNode", () => {
  test("決定的（同じ t/seed で同じ値）", () => {
    const p = { speed: 1, seed: 1, amplitude: 1, offset: 0 };
    const a = NoiseNode.evaluate(ctx({ timeSec: 2.5, params: p })).out as number;
    const b = NoiseNode.evaluate(ctx({ timeSec: 2.5, params: p })).out as number;
    expect(a).toBe(b);
    expect(a).toBeGreaterThanOrEqual(-1);
    expect(a).toBeLessThanOrEqual(1);
  });
});

describe("AddNode", () => {
  test("a+b（未接続は param）", () => {
    expect(AddNode.evaluate(ctx({ inputs: { a: 2, b: 3 } })).out).toBe(5);
  });
});

describe("RemapNode", () => {
  test("範囲変換 + clamp", () => {
    const out = RemapNode.evaluate(ctx({
      inputs: { in: 0.15 },
      params: { inMin: 0, inMax: 0.3, outMin: 0.1, outMax: 1.5, clamp: true },
    }));
    expect(out.out as number).toBeCloseTo(0.8, 6);
  });
});

describe("SmoothNode", () => {
  test("初回は入力で初期化、以降 EMA で収束", () => {
    const s = new SmoothRuntime();
    const params = { factor: 0.5 };
    // 1回目: in=10 → prime → 10
    expect(SmoothNode.evaluate(ctx({ inputs: { in: 10 }, params, state: s })).out).toBe(10);
    // 2回目: in=0 → 10 + (0-10)*0.5 = 5
    expect(SmoothNode.evaluate(ctx({ inputs: { in: 0 }, params, state: s })).out).toBe(5);
    // 3回目: in=0 → 5 + (0-5)*0.5 = 2.5
    expect(SmoothNode.evaluate(ctx({ inputs: { in: 0 }, params, state: s })).out).toBe(2.5);
  });
  test("state 無しなら入力をそのまま返す", () => {
    expect(SmoothNode.evaluate(ctx({ inputs: { in: 7 }, params: { factor: 0.5 } })).out).toBe(7);
  });
});
