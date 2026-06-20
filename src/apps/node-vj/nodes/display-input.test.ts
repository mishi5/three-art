import { expect, test, describe } from "bun:test";
import { DisplayInputNode } from "./DisplayInputNode";
import { createDefaultRegistry } from "./registry";
import { nodeHasPreview } from "../editor/NodeEditor";
import type { EvalContext } from "../graph/node-type";
import { DEFAULT_AUDIO_FEATURES } from "../../../core/types";

const ctxNoState = (): EvalContext => ({
  timeSec: 0, input: () => undefined, param: () => undefined,
  node: { id: "x", type: "DisplayInput", params: {} },
});

const FEATURE_IDS = ["signal", "volume", "bass", "mid", "treble", "onset"];

describe("DisplayInputNode (#140 AV 化)", () => {
  test("type/category", () => {
    expect(DisplayInputNode.type).toBe("DisplayInput");
    expect(DisplayInputNode.category).toBe("input");
  });

  test("出力: texture + 音響特徴量 + audio(実音声)", () => {
    expect(DisplayInputNode.outputs.map((p) => p.id)).toEqual(["texture", ...FEATURE_IDS, "audio"]);
    expect(DisplayInputNode.outputs.find((p) => p.id === "texture")?.type).toBe("texture");
    expect(DisplayInputNode.outputs.find((p) => p.id === "audio")?.type).toBe("audio");
    expect(DisplayInputNode.outputs.find((p) => p.id === "signal")?.type).toBe("signal");
  });

  test("params: onset しきい値・cooldown", () => {
    expect(DisplayInputNode.params.map((p) => p.id)).toEqual(["onsetThreshold", "onsetCooldown"]);
  });

  test("state 無しは onset=false・デフォルト signal・texture 無し", () => {
    const out = DisplayInputNode.evaluate(ctxNoState());
    expect(out.signal).toBe(DEFAULT_AUDIO_FEATURES);
    expect(out.onset).toBe(false);
    expect(out.texture).toBeUndefined();
  });

  test("プレビュー対象である（texture 出力あり）", () => {
    expect(nodeHasPreview(DisplayInputNode)).toBe(true);
    expect(typeof DisplayInputNode.previewSource).toBe("function");
  });

  test("registry に DisplayInput が登録・旧 DisplayAudioInput は無し", () => {
    const r = createDefaultRegistry();
    expect(r.get("DisplayInput")).toBeDefined();
    expect(r.get("DisplayAudioInput")).toBeUndefined();
  });
});
