import { expect, test, describe } from "bun:test";
import { PointShapeNode } from "./PointShapeNode";
import { ParticleRenderNode } from "./ParticleRenderNode";
import type { EvalContext } from "../graph/node-type";

function ctxNoState(over: Partial<EvalContext> = {}): EvalContext {
  return {
    timeSec: 0,
    input: () => undefined,
    param: () => undefined,
    node: { id: "x", type: "T", params: {} },
    ...over,
  };
}

describe("PointShapeNode (#101)", () => {
  test("points 出力を持つ generator ノード", () => {
    expect(PointShapeNode.type).toBe("PointShape");
    expect(PointShapeNode.category).toBe("generator");
    expect(PointShapeNode.outputs.map((p) => `${p.id}:${p.type}`)).toEqual(["points:points"]);
  });
  test("count / radius param を持つ", () => {
    const ids = PointShapeNode.params.map((p) => p.id);
    expect(ids).toContain("count");
    expect(ids).toContain("radius");
  });
  test("state/env 無しでは no-op（空オブジェクト）", () => {
    expect(PointShapeNode.evaluate(ctxNoState())).toEqual({});
  });
});

describe("ParticleRenderNode (#101)", () => {
  test("points/audio 入力・texture 出力の sink", () => {
    expect(ParticleRenderNode.type).toBe("ParticleRender");
    expect(ParticleRenderNode.category).toBe("visual");
    expect(ParticleRenderNode.isSink).toBe(true);
    expect(ParticleRenderNode.inputs.find((p) => p.id === "points")?.type).toBe("points");
    expect(ParticleRenderNode.inputs.find((p) => p.id === "signal")?.type).toBe("signal");
    expect(ParticleRenderNode.outputs.map((p) => `${p.id}:${p.type}`)).toEqual(["texture:texture"]);
  });
  test("描画・色 param を集約（baseSize/volumeSize/hueBase 等）", () => {
    const ids = ParticleRenderNode.params.map((p) => p.id);
    for (const k of ["baseSize", "volumeSize", "bassExpansion", "hueBase", "hueSpread", "saturation"]) {
      expect(ids).toContain(k);
    }
  });
  test("state/env 無しでは no-op（空オブジェクト）", () => {
    expect(ParticleRenderNode.evaluate(ctxNoState())).toEqual({});
  });
});
