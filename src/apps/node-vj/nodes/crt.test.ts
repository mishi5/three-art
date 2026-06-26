import * as THREE from "three";
import { expect, test, describe } from "bun:test";
import { CrtNode } from "./CrtNode";
import { createDefaultRegistry } from "./registry";
import type { EvalContext } from "../graph/node-type";

const noCtx: EvalContext = {
  timeSec: 0, input: () => undefined, param: () => undefined,
  node: { id: "x", type: "Crt", params: {} },
};

describe("CrtNode (#192)", () => {
  test("texture→texture の effect ノード", () => {
    expect(CrtNode.inputs.map((p) => p.type)).toEqual(["texture"]);
    expect(CrtNode.outputs.map((p) => p.type)).toEqual(["texture"]);
    expect(CrtNode.category).toBe("effect");
    expect(CrtNode.isSink).toBe(true);
    expect(CrtNode.evaluate(noCtx)).toEqual({}); // state/env なしは no-op
  });

  test("params: enabled + scanline/scanlineCount/colorBleed/noise/vignette", () => {
    expect(CrtNode.params.map((p) => p.id)).toEqual([
      "enabled", "scanline", "scanlineCount", "colorBleed", "noise", "vignette",
    ]);
    expect(CrtNode.params.find((p) => p.id === "enabled")?.default).toBe("on");
  });

  test("registry に登録されている", () => {
    expect(createDefaultRegistry().get("Crt")).toBeDefined();
  });

  // #196: 走査線の本数は描画バッファ解像度から独立した param で持つ。
  // 以前は uv.y * uResolution.y で1px周期になり、表示時のダウンサンプリングで潰れて見えなかった。
  test("走査線本数は uResolution から独立した param（uScanlineCount uniform・既定240）", () => {
    const st = CrtNode.createState!({} as never) as unknown as {
      material: THREE.ShaderMaterial;
      dispose: () => void;
    };
    expect(st.material.uniforms.uScanlineCount?.value).toBe(240);
    st.dispose();
  });
});
