import { expect, test, describe } from "bun:test";
import { FlipFlopNode, FlipFlopRuntime } from "./FlipFlopNode";
import type { EvalContext } from "../graph/node-type";

function ctx(state: FlipFlopRuntime | undefined, trigger: boolean, initial = "off"): EvalContext {
  return {
    timeSec: 0,
    input: (id) => (id === "trigger" ? trigger : undefined),
    param: (id) => (id === "initial" ? initial : undefined),
    node: { id: "f", type: "FlipFlop", params: {} },
    state,
  };
}
const out = (r: Record<string, unknown>) => (r as { out: number }).out;

describe("FlipFlopNode (#111)", () => {
  test("trigger 入力・number 出力・initial param", () => {
    expect(FlipFlopNode.type).toBe("FlipFlop");
    expect(FlipFlopNode.category).toBe("process");
    expect(FlipFlopNode.inputs.map((p) => `${p.id}:${p.type}`)).toEqual(["trigger:trigger"]);
    expect(FlipFlopNode.outputs.map((p) => `${p.id}:${p.type}`)).toEqual(["out:number"]);
    const init = FlipFlopNode.params.find((p) => p.id === "initial");
    expect(init?.kind).toBe("enum");
    expect(init?.options).toEqual(["off", "on"]);
    expect(init?.default).toBe("off");
  });

  test("発火（立ち上がりエッジ）で反転・非発火で維持", () => {
    const s = new FlipFlopRuntime();
    expect(out(FlipFlopNode.evaluate(ctx(s, false)))).toBe(0); // 初期 off
    expect(out(FlipFlopNode.evaluate(ctx(s, true)))).toBe(1);  // 発火→反転
    expect(out(FlipFlopNode.evaluate(ctx(s, true)))).toBe(1);  // true 維持中は反転しない
    expect(out(FlipFlopNode.evaluate(ctx(s, false)))).toBe(1); // 非発火→維持
    expect(out(FlipFlopNode.evaluate(ctx(s, true)))).toBe(0);  // 再発火→反転
  });

  test("initial=on で 1 始まり", () => {
    const s = new FlipFlopRuntime();
    expect(out(FlipFlopNode.evaluate(ctx(s, false, "on")))).toBe(1);
    expect(out(FlipFlopNode.evaluate(ctx(s, true, "on")))).toBe(0);
  });

  test("state 無しでは 0", () => {
    expect(out(FlipFlopNode.evaluate(ctx(undefined, true)))).toBe(0);
  });
});
