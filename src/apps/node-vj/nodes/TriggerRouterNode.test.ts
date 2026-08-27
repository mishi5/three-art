// #272: TriggerRouter ノード（index → 個別 trigger への分配）のテスト。
import { describe, expect, test } from "bun:test";
import { TriggerRouterNode, TriggerRouterRuntime } from "./TriggerRouterNode";
import { ROUTER_OUTPUTS } from "./midi-node-logic";
import type { EvalContext } from "../graph/node-type";
import type { NodeInstance } from "../graph/graph-doc";

function ctxFor(
  state: TriggerRouterRuntime | undefined,
  inputs: Record<string, unknown> = {},
  node?: NodeInstance,
): EvalContext {
  const n = node ?? { id: "n1", type: "TriggerRouter", params: {} };
  return {
    timeSec: 0,
    input: (id: string) => inputs[id],
    param: (id: string) =>
      id in n.params ? n.params[id] : TriggerRouterNode.params.find((p) => p.id === id)?.default,
    node: n,
    state,
  };
}

/** 発火している出力 id の一覧。 */
function fired(out: Record<string, unknown>): string[] {
  return Object.keys(out).filter((k) => out[k] === true);
}

describe("#272 TriggerRouterNode 定義", () => {
  test("control カテゴリ・index/trig 入力・t1..t16 の trigger 出力", () => {
    expect(TriggerRouterNode.type).toBe("TriggerRouter");
    expect(TriggerRouterNode.category).toBe("control");
    expect(TriggerRouterNode.inputs.map((p) => p.id)).toEqual(["index", "trig"]);
    expect(TriggerRouterNode.inputs.find((p) => p.id === "index")!.type).toBe("number");
    expect(TriggerRouterNode.inputs.find((p) => p.id === "trig")!.type).toBe("trigger");
    expect(TriggerRouterNode.outputs).toHaveLength(ROUTER_OUTPUTS);
    expect(TriggerRouterNode.outputs.map((o) => o.id))
      .toEqual(Array.from({ length: ROUTER_OUTPUTS }, (_v, i) => `t${i + 1}`));
    for (const o of TriggerRouterNode.outputs) expect(o.type).toBe("trigger");
  });

  test("offset は noInput の int param", () => {
    const p = TriggerRouterNode.params.find((x) => x.id === "offset")!;
    expect(p.kind).toBe("int");
    expect(p.default).toBe(0);
    expect(p.noInput).toBe(true);
  });
});

describe("#272 TriggerRouter: trig 接続時（立ち上がりで発火）", () => {
  test("index に対応する 1 本だけが 1 フレーム発火する", () => {
    const rt = new TriggerRouterRuntime();
    expect(fired(TriggerRouterNode.evaluate(ctxFor(rt, { index: 2, trig: false })))).toEqual([]);
    expect(fired(TriggerRouterNode.evaluate(ctxFor(rt, { index: 2, trig: true })))).toEqual(["t3"]);
    // 押しっぱなしでは連続発火しない。
    expect(fired(TriggerRouterNode.evaluate(ctxFor(rt, { index: 2, trig: true })))).toEqual([]);
  });

  test("index が同じでも trig を打ち直せば再発火する", () => {
    const rt = new TriggerRouterRuntime();
    TriggerRouterNode.evaluate(ctxFor(rt, { index: 0, trig: true }));
    TriggerRouterNode.evaluate(ctxFor(rt, { index: 0, trig: false }));
    expect(fired(TriggerRouterNode.evaluate(ctxFor(rt, { index: 0, trig: true })))).toEqual(["t1"]);
  });

  test("index は四捨五入する", () => {
    const rt = new TriggerRouterRuntime();
    expect(fired(TriggerRouterNode.evaluate(ctxFor(rt, { index: 2.6, trig: true })))).toEqual(["t4"]);
  });

  test("範囲外の index では何も発火しない", () => {
    const rt = new TriggerRouterRuntime();
    expect(fired(TriggerRouterNode.evaluate(ctxFor(rt, { index: 16, trig: true })))).toEqual([]);
    TriggerRouterNode.evaluate(ctxFor(rt, { index: -1, trig: false }));
    expect(fired(TriggerRouterNode.evaluate(ctxFor(rt, { index: -1, trig: true })))).toEqual([]);
  });

  test("offset を足してから振り分ける", () => {
    const rt = new TriggerRouterRuntime();
    const node: NodeInstance = { id: "n1", type: "TriggerRouter", params: { offset: -16 } };
    expect(fired(TriggerRouterNode.evaluate(ctxFor(rt, { index: 16, trig: true }, node))))
      .toEqual(["t1"]);
  });
});

describe("#272 TriggerRouter: trig 未接続時（index の変化で発火）", () => {
  test("index が変わった瞬間に対応する出力が発火する", () => {
    // trigger 入力は未接続だと undefined が返る（BeatClock の tap/onset と同じ）。
    const rt = new TriggerRouterRuntime();
    // 初回は基準合わせのみ（起動直後に暴発しない）。
    expect(fired(TriggerRouterNode.evaluate(ctxFor(rt, { index: 0 })))).toEqual([]);
    expect(fired(TriggerRouterNode.evaluate(ctxFor(rt, { index: 3 })))).toEqual(["t4"]);
    // 変化がなければ発火しない。
    expect(fired(TriggerRouterNode.evaluate(ctxFor(rt, { index: 3 })))).toEqual([]);
    expect(fired(TriggerRouterNode.evaluate(ctxFor(rt, { index: 0 })))).toEqual(["t1"]);
  });

  test("index 未接続なら何も発火しない", () => {
    const rt = new TriggerRouterRuntime();
    expect(fired(TriggerRouterNode.evaluate(ctxFor(rt, {})))).toEqual([]);
    expect(fired(TriggerRouterNode.evaluate(ctxFor(rt, {})))).toEqual([]);
  });
});

describe("#272 TriggerRouter: 出力の形", () => {
  test("発火していない出力も false で揃える（未定義にしない）", () => {
    const out = TriggerRouterNode.evaluate(ctxFor(new TriggerRouterRuntime(), { index: 0, trig: true }));
    expect(Object.keys(out)).toHaveLength(ROUTER_OUTPUTS);
    expect(out.t2).toBe(false);
  });

  test("state 無しでも全出力 false で落ちない", () => {
    const out = TriggerRouterNode.evaluate(ctxFor(undefined, { index: 0, trig: true }));
    expect(fired(out)).toEqual([]);
    expect(Object.keys(out)).toHaveLength(ROUTER_OUTPUTS);
  });
});
