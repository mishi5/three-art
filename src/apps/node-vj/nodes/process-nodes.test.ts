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

describe("SineNode: sync（#270）", () => {
  const params = { freq: 1, amplitude: 1, offset: 0 };

  test("sync trigger 入力を持つ", () => {
    const sync = SineNode.inputs.find((p) => p.id === "sync")!;
    expect(sync.type).toBe("trigger");
  });

  test("sync 未接続時は state があっても従来どおり（t0=0）", () => {
    const s = SineNode.createState!({} as never);
    const out = SineNode.evaluate(ctx({ timeSec: 0.25, params, state: s }));
    expect(out.out as number).toBeCloseTo(1, 6); // sin(2π·0.25)=1
  });

  test("sync の立ち上がりエッジで位相 0（sin の立ち上がり）から再開する", () => {
    const s = SineNode.createState!({} as never);
    expect(SineNode.evaluate(ctx({ timeSec: 0.25, params, state: s })).out as number).toBeCloseTo(1, 6);
    // sync エッジ → t0=0.4 → sin(0)=0。
    expect(SineNode.evaluate(ctx({ timeSec: 0.4, inputs: { sync: true }, params, state: s })).out as number)
      .toBeCloseTo(0, 6);
    // sync 押しっぱなし（エッジなし）→ 再リセットせず t-t0=0.25 → 1。
    expect(SineNode.evaluate(ctx({ timeSec: 0.65, inputs: { sync: true }, params, state: s })).out as number)
      .toBeCloseTo(1, 6);
    // 一度 false に戻して再度 true → 再リセット。
    SineNode.evaluate(ctx({ timeSec: 0.9, inputs: { sync: false }, params, state: s }));
    expect(SineNode.evaluate(ctx({ timeSec: 1.17, inputs: { sync: true }, params, state: s })).out as number)
      .toBeCloseTo(0, 6);
  });

  test("t 入力接続時は実効 t（入力値）を基準にリセットする", () => {
    const s = SineNode.createState!({} as never);
    expect(SineNode.evaluate(ctx({ timeSec: 99, inputs: { t: 5, sync: true }, params, state: s })).out as number)
      .toBeCloseTo(0, 6); // t0=5
    expect(SineNode.evaluate(ctx({ timeSec: 99, inputs: { t: 5.25 }, params, state: s })).out as number)
      .toBeCloseTo(1, 6); // t-t0=0.25
  });

  test("state 無し（旧テスト互換）でも sync を無視して従来出力", () => {
    const out = SineNode.evaluate(ctx({ timeSec: 0.25, inputs: { sync: true }, params }));
    expect(out.out as number).toBeCloseTo(1, 6);
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

describe("NoiseNode: sync（#270）", () => {
  const params = { speed: 1, seed: 1, amplitude: 1, offset: 0 };

  test("sync trigger 入力を持つ", () => {
    const sync = NoiseNode.inputs.find((p) => p.id === "sync")!;
    expect(sync.type).toBe("trigger");
  });

  test("sync 未接続時は state があっても従来どおり（t0=0）", () => {
    const s = NoiseNode.createState!({} as never);
    const plain = NoiseNode.evaluate(ctx({ timeSec: 2.5, params })).out as number;
    const withState = NoiseNode.evaluate(ctx({ timeSec: 2.5, params, state: s })).out as number;
    expect(withState).toBe(plain);
  });

  test("sync の立ち上がりエッジで noise3D の走査位置が原点（t=0 相当）に戻る", () => {
    const s = NoiseNode.createState!({} as never);
    const origin = NoiseNode.evaluate(ctx({ timeSec: 0, params })).out as number; // t=0 の値
    const synced = NoiseNode.evaluate(ctx({ timeSec: 7.3, inputs: { sync: true }, params, state: s })).out as number;
    expect(synced).toBe(origin);
    // リセット後は t-t0 で従来と同じ軌跡を辿る。
    const after = NoiseNode.evaluate(ctx({ timeSec: 7.8, params, state: s })).out as number;
    const expected = NoiseNode.evaluate(ctx({ timeSec: 0.5, params })).out as number;
    expect(after).toBe(expected);
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
