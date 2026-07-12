// #282: Screen ノードの def 形状テスト（ワープ 4 隅 param・出力ウィンドウトグルの目印）。
import { describe, expect, test } from "bun:test";
import { ScreenNode } from "./ScreenNode";
import { SCREEN_TEXTURE_KEY } from "../graph/texture-screen";
import { DEFAULT_CORNERS, WARP_MAX, WARP_MIN, WARP_PARAM_IDS } from "../warp-logic";
import type { EvalContext } from "../graph/node-type";

describe("ScreenNode ワープ param (#282)", () => {
  test("param は 4 隅 × xy の 8 個（WARP_PARAM_IDS と同順）", () => {
    expect(ScreenNode.params.map((p) => p.id)).toEqual([...WARP_PARAM_IDS]);
  });

  test("全 param が number・noInput（ポート化しない）・hidden ではない（手入力微調整可）", () => {
    for (const p of ScreenNode.params) {
      expect(p.kind).toBe("number");
      expect(p.noInput).toBe(true);
      expect(p.hidden).toBeUndefined();
      expect(p.min).toBe(WARP_MIN);
      expect(p.max).toBe(WARP_MAX);
      expect(p.step).toBe(0.001);
      expect(typeof p.description).toBe("string");
    }
  });

  test("default はワープなしの 4 隅（tl=(0,0) tr=(1,0) bl=(0,1) br=(1,1)）", () => {
    const d = Object.fromEntries(ScreenNode.params.map((p) => [p.id, p.default]));
    expect(d).toEqual({
      tlX: DEFAULT_CORNERS.tl.x, tlY: DEFAULT_CORNERS.tl.y,
      trX: DEFAULT_CORNERS.tr.x, trY: DEFAULT_CORNERS.tr.y,
      blX: DEFAULT_CORNERS.bl.x, blY: DEFAULT_CORNERS.bl.y,
      brX: DEFAULT_CORNERS.br.x, brY: DEFAULT_CORNERS.br.y,
    });
  });

  test("screenOutput フラグ（出力ウィンドウトグル行の目印）が立っている", () => {
    expect(ScreenNode.screenOutput).toBe(true);
  });

  test("evaluate は従来どおり texture を SCREEN_TEXTURE_KEY へ記録する（無変更）", () => {
    const tex = { fake: "texture" };
    const ctx = {
      input: (id: string) => (id === "texture" ? tex : undefined),
      param: () => 0,
      timeSec: 0,
      node: { id: "s1", type: "Screen", params: {} },
    } as unknown as EvalContext;
    expect(ScreenNode.evaluate(ctx)).toEqual({ [SCREEN_TEXTURE_KEY]: tex });
  });
});
