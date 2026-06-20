import { expect, test, describe } from "bun:test";
import { ImageFileInputNode } from "./ImageFileInputNode";
import { createDefaultRegistry } from "./registry";
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

describe("ImageFileInputNode (#121)", () => {
  test("input カテゴリで texture を出力し、入力ポートは持たない", () => {
    expect(ImageFileInputNode.type).toBe("ImageFileInput");
    expect(ImageFileInputNode.category).toBe("input");
    expect(ImageFileInputNode.inputs).toEqual([]);
    expect(ImageFileInputNode.outputs.map((p) => p.id)).toEqual(["texture"]);
    expect(ImageFileInputNode.outputs.find((p) => p.id === "texture")?.type).toBe("texture");
  });

  test("画像ファイル選択 UI（fileInput: image/*）を持つ", () => {
    expect(ImageFileInputNode.fileInput?.accept).toBe("image/*");
  });

  test("state 無しでも texture 無しを安全に返す（headless）", () => {
    const out = ImageFileInputNode.evaluate(ctxNoState());
    expect(out.texture).toBeUndefined();
  });

  test("registry に ImageFileInput が登録されている", () => {
    const r = createDefaultRegistry();
    expect(r.get("ImageFileInput")).toBeDefined();
  });
});
