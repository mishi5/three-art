import { expect, test, describe } from "bun:test";
import { MicInputNode } from "./MicInputNode";
import { DisplayAudioInputNode } from "./DisplayAudioInputNode";
import { AudioFileInputNode } from "./AudioFileInputNode";
import { nodeHasPreview } from "../editor/NodeEditor";
import type { EvalContext } from "../graph/node-type";
import { DEFAULT_AUDIO_FEATURES } from "../../../core/types";

// state なしの evaluate でも安全なデフォルトを返すことを確認（headless）。
function ctxNoState(over: Partial<EvalContext> = {}): EvalContext {
  return {
    timeSec: 0,
    input: () => undefined,
    param: () => undefined,
    node: { id: "x", type: "T", params: {} },
    ...over,
  };
}

const FEATURE_IDS = ["audio", "volume", "bass", "mid", "treble", "onset"];

describe("MicInputNode (#100)", () => {
  test("ポート定義: 音響特徴量のみ（section 無し）・onset param（#109）", () => {
    expect(MicInputNode.type).toBe("MicInput");
    expect(MicInputNode.category).toBe("input");
    expect(MicInputNode.outputs.map((p) => p.id)).toEqual(FEATURE_IDS);
    expect(MicInputNode.params.map((p) => p.id)).toEqual(["onsetThreshold", "onsetCooldown"]);
  });

  test("state 無しでは onset=false・デフォルト audio", () => {
    const out = MicInputNode.evaluate(ctxNoState());
    expect(out.audio).toBe(DEFAULT_AUDIO_FEATURES);
    expect(out.onset).toBe(false);
    expect(out.volume).toBe(0);
  });

  test("プレビュー対象でない（texture/previewSource 無し）", () => {
    expect(nodeHasPreview(MicInputNode)).toBe(false);
  });
});

describe("DisplayAudioInputNode (#100)", () => {
  test("ポート定義: 音響特徴量のみ（section 無し）・onset param（#109）", () => {
    expect(DisplayAudioInputNode.type).toBe("DisplayAudioInput");
    expect(DisplayAudioInputNode.outputs.map((p) => p.id)).toEqual(FEATURE_IDS);
    expect(DisplayAudioInputNode.params.map((p) => p.id)).toEqual(["onsetThreshold", "onsetCooldown"]);
  });

  test("state 無しでは onset=false・デフォルト audio", () => {
    const out = DisplayAudioInputNode.evaluate(ctxNoState());
    expect(out.audio).toBe(DEFAULT_AUDIO_FEATURES);
    expect(out.onset).toBe(false);
  });

  test("プレビュー対象でない", () => {
    expect(nodeHasPreview(DisplayAudioInputNode)).toBe(false);
  });
});

describe("AudioFileInputNode (#100)", () => {
  test("ポート定義: 音響特徴量 + section(number)", () => {
    expect(AudioFileInputNode.type).toBe("AudioFileInput");
    expect(AudioFileInputNode.outputs.map((p) => p.id)).toEqual([...FEATURE_IDS, "section"]);
    expect(AudioFileInputNode.outputs.find((p) => p.id === "section")?.type).toBe("number");
    expect(AudioFileInputNode.outputs.find((p) => p.id === "audio")?.type).toBe("audio");
  });

  test("state 無しでは section=-1・onset=false・デフォルト audio", () => {
    const out = AudioFileInputNode.evaluate(ctxNoState());
    expect(out.section).toBe(-1);
    expect(out.onset).toBe(false);
    expect(out.audio).toBe(DEFAULT_AUDIO_FEATURES);
  });

  test("loadFile を持つ（ファイル読込 user gesture 用）", () => {
    expect(typeof AudioFileInputNode.createState).toBe("function");
  });

  test("loop param（enum on/off, 既定 on）を持つ（#115, VideoFileInput と同形）", () => {
    const loop = AudioFileInputNode.params.find((p) => p.id === "loop");
    expect(loop?.kind).toBe("enum");
    expect(loop?.options).toEqual(["on", "off"]);
    expect(loop?.default).toBe("on");
  });

  test("プレビュー対象でない", () => {
    expect(nodeHasPreview(AudioFileInputNode)).toBe(false);
  });
});
