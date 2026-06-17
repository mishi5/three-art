import { expect, test, describe } from "bun:test";
import { EnvelopeNode, EnvelopeRuntime, envelopeValue } from "./EnvelopeNode";
import type { EvalContext } from "../graph/node-type";

describe("envelopeValue (#110)", () => {
  test("elapsed<0 は 0", () => {
    expect(envelopeValue(-1, 0.1, 0.3)).toBe(0);
  });
  test("attack 中は線形に 0→1", () => {
    expect(envelopeValue(0, 0.1, 0.3)).toBeCloseTo(0, 6);
    expect(envelopeValue(0.05, 0.1, 0.3)).toBeCloseTo(0.5, 6);
    expect(envelopeValue(0.1, 0.1, 0.3)).toBeCloseTo(1, 6);
  });
  test("release 中は線形に 1→0", () => {
    // attack=0.1, release=0.3。elapsed=0.1+0.15=0.25 → 半分
    expect(envelopeValue(0.25, 0.1, 0.3)).toBeCloseTo(0.5, 6);
    expect(envelopeValue(0.4, 0.1, 0.3)).toBeCloseTo(0, 6);
  });
  test("終了後は 0", () => {
    expect(envelopeValue(1.0, 0.1, 0.3)).toBe(0);
  });
  test("attack=0 は発火直後に 1", () => {
    expect(envelopeValue(0, 0, 0.3)).toBeCloseTo(1, 6);
    expect(envelopeValue(0.15, 0, 0.3)).toBeCloseTo(0.5, 6);
  });
});

describe("EnvelopeNode (#110)", () => {
  test("trigger 入力・number 出力の process ノード", () => {
    expect(EnvelopeNode.type).toBe("Envelope");
    expect(EnvelopeNode.category).toBe("process");
    expect(EnvelopeNode.inputs.map((p) => `${p.id}:${p.type}`)).toEqual(["trigger:trigger"]);
    expect(EnvelopeNode.outputs.map((p) => `${p.id}:${p.type}`)).toEqual(["out:number"]);
    const ids = EnvelopeNode.params.map((p) => p.id);
    expect(ids).toEqual(["attack", "release"]);
  });

  // フレーム駆動シミュレーション
  function ctx(state: EnvelopeRuntime, t: number, trigger: boolean): EvalContext {
    return {
      timeSec: t,
      input: (id) => (id === "trigger" ? trigger : undefined),
      param: (id) => (id === "attack" ? 0 : id === "release" ? 0.4 : undefined),
      node: { id: "e", type: "Envelope", params: {} },
      state,
    };
  }

  test("発火で立ち上がり→減衰→0、立ち上がりエッジのみ発火", () => {
    const s = new EnvelopeRuntime();
    // 発火前
    expect((EnvelopeNode.evaluate(ctx(s, 0.0, false)) as { out: number }).out).toBe(0);
    // 発火（attack=0 → 即 1）
    expect((EnvelopeNode.evaluate(ctx(s, 1.0, true)) as { out: number }).out).toBeCloseTo(1, 6);
    // trigger 維持中（true のまま）でも再発火しない：時間が進めば減衰する
    expect((EnvelopeNode.evaluate(ctx(s, 1.2, true)) as { out: number }).out).toBeCloseTo(0.5, 6);
    // release 終了
    expect((EnvelopeNode.evaluate(ctx(s, 1.4, false)) as { out: number }).out).toBeCloseTo(0, 6);
  });

  test("再トリガー（false→true）でリセット", () => {
    const s = new EnvelopeRuntime();
    EnvelopeNode.evaluate(ctx(s, 1.0, true));
    EnvelopeNode.evaluate(ctx(s, 1.3, false));     // ほぼ減衰
    // 再び false→true で立ち上がり
    expect((EnvelopeNode.evaluate(ctx(s, 2.0, true)) as { out: number }).out).toBeCloseTo(1, 6);
  });

  test("state 無しでは 0", () => {
    const c = ctx(new EnvelopeRuntime(), 0, false);
    expect((EnvelopeNode.evaluate({ ...c, state: undefined }) as { out: number }).out).toBe(0);
  });
});
