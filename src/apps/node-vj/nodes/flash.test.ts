import { expect, test, describe } from "bun:test";
import { FlashNode, FlashRuntime } from "./FlashNode";
import type { EvalContext } from "../graph/node-type";

describe("FlashRuntime (#112)", () => {
  test("立ち上がりエッジで triggerTime 更新（連続 true で再発火しない）・level 減衰", () => {
    const r = new FlashRuntime();
    // 発火前
    r.feed(false, 0.0);
    expect(r.getLevel(0.0, 0.2)).toBe(0);
    // 発火（立ち上がり）→ 即 1
    r.feed(true, 1.0);
    expect(r.getLevel(1.0, 0.2)).toBeCloseTo(1, 6);
    // true 維持中は triggerTime を更新しない → 時間経過で減衰
    r.feed(true, 1.1);
    expect(r.getLevel(1.1, 0.2)).toBeCloseTo(0.5, 6);
    // release 終了で 0
    r.feed(false, 1.3);
    expect(r.getLevel(1.3, 0.2)).toBeCloseTo(0, 6);
    // 再度立ち上がりで再点灯
    r.feed(true, 2.0);
    expect(r.getLevel(2.0, 0.2)).toBeCloseTo(1, 6);
  });
});

describe("FlashNode (#112)", () => {
  test("trigger + 任意 texture 入力・texture 出力の effect ノード", () => {
    expect(FlashNode.type).toBe("Flash");
    expect(FlashNode.category).toBe("effect");
    expect(FlashNode.inputs.find((p) => p.id === "trigger")?.type).toBe("trigger");
    expect(FlashNode.inputs.find((p) => p.id === "in")?.type).toBe("texture");
    expect(FlashNode.outputs.map((p) => `${p.id}:${p.type}`)).toEqual(["texture:texture"]);
  });

  test("release/hue/saturation param を持つ", () => {
    const ids = FlashNode.params.map((p) => p.id);
    for (const k of ["release", "hue", "saturation"]) expect(ids).toContain(k);
  });

  test("state/env 無しでは no-op（空オブジェクト）", () => {
    const ctx: EvalContext = {
      timeSec: 0, input: () => undefined, param: () => undefined,
      node: { id: "x", type: "Flash", params: {} },
    };
    expect(FlashNode.evaluate(ctx)).toEqual({});
  });
});
