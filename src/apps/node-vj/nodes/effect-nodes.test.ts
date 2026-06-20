import { expect, test, describe } from "bun:test";
import { BlurNode } from "./BlurNode";
import { KaleidoscopeNode } from "./KaleidoscopeNode";
import { FractalNode } from "./FractalNode";
import { EdgeVisualNode, buildEdgeParams } from "./EdgeVisualNode";
import { createDefaultRegistry } from "./registry";
import type { EvalContext } from "../graph/node-type";

const noCtx = (type: string): EvalContext => ({
  timeSec: 0, input: () => undefined, param: () => undefined,
  node: { id: "x", type, params: {} },
});

describe("effect nodes (#64)", () => {
  test("texture→texture のポート定義（Blur/Kaleidoscope/Fractal）", () => {
    for (const n of [BlurNode, KaleidoscopeNode, FractalNode]) {
      expect(n.inputs.map((p) => p.type)).toEqual(["texture"]);
      expect(n.outputs.map((p) => p.type)).toEqual(["texture"]);
      expect(n.category).toBe("effect");
      expect(n.evaluate(noCtx(n.type))).toEqual({}); // state/env なしは no-op
    }
  });

  test("Blur の params は enabled + strength（#134）", () => {
    expect(BlurNode.params.map((p) => p.id)).toEqual(["enabled", "strength"]);
  });

  test("effect 各ノードに enabled トグルがある（#134）", () => {
    for (const n of [BlurNode, KaleidoscopeNode, FractalNode]) {
      const en = n.params.find((p) => p.id === "enabled");
      expect(en?.kind).toBe("enum");
      expect(en?.default).toBe("on");
    }
  });

  test("EdgeVisual は pose/audio 入力 + texture 出力の visual", () => {
    expect(EdgeVisualNode.inputs.map((p) => p.type)).toEqual(["pose", "signal"]);
    expect(EdgeVisualNode.outputs.map((p) => p.type)).toEqual(["texture"]);
    expect(EdgeVisualNode.category).toBe("visual"); // 終端で自動表示対象
  });

  test("buildEdgeParams: curated 反映＋既定（wave/rewire は OFF）", () => {
    const p = buildEdgeParams({ mode: "sphere", anchorCount: 128, alpha: 0.8 });
    expect(p.mode).toBe("sphere");
    expect(p.edges.anchorCount).toBe(128);
    expect(p.edges.alpha).toBe(0.8);
    expect(p.edges.enabled).toBe(true);
    expect(p.edges.wave.enabled).toBe(false);
    expect(p.edges.rewire.enabled).toBe(false);
    expect(p.shape.radius).toBe(0.4);
  });

  test("registry に 4 ノードが登録されている", () => {
    const r = createDefaultRegistry();
    for (const t of ["Blur", "Kaleidoscope", "Fractal", "EdgeVisual"]) {
      expect(r.get(t)).toBeDefined();
    }
  });
});
