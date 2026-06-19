import { expect, test, describe } from "bun:test";
import { VideoFileInputNode } from "./VideoFileInputNode";
import { nodeHasPreview } from "../editor/NodeEditor";
import type { EvalContext } from "../graph/node-type";
import { DEFAULT_AUDIO_FEATURES } from "../../../core/types";

// state なしの evaluate でも安全なデフォルトを返すことを確認（headless）。
function ctxNoState(over: Partial<EvalContext> = {}): EvalContext {
  return {
    timeSec: 0,
    input: () => undefined,
    param: () => undefined,
    node: { id: "x", type: "VideoFileInput", params: {} },
    ...over,
  };
}

const FEATURE_IDS = ["audio", "volume", "bass", "mid", "treble", "onset"];

describe("VideoFileInputNode 音声特徴量出力 (#116)", () => {
  test("ポート定義: texture + 音響特徴量（section 無し）", () => {
    expect(VideoFileInputNode.outputs.map((p) => p.id)).toEqual(["texture", ...FEATURE_IDS]);
    expect(VideoFileInputNode.outputs.find((p) => p.id === "texture")?.type).toBe("texture");
    expect(VideoFileInputNode.outputs.find((p) => p.id === "audio")?.type).toBe("audio");
    expect(VideoFileInputNode.outputs.find((p) => p.id === "onset")?.type).toBe("trigger");
  });

  test("params: loop / audio(off,on 既定 off) / onset しきい値・cooldown", () => {
    expect(VideoFileInputNode.params.map((p) => p.id)).toEqual([
      "loop", "audio", "onsetThreshold", "onsetCooldown",
    ]);
    const audio = VideoFileInputNode.params.find((p) => p.id === "audio");
    expect(audio?.kind).toBe("enum");
    expect(audio?.options).toEqual(["off", "on"]);
    expect(audio?.default).toBe("off"); // 既定 OFF で既存の無音挙動を維持
  });

  test("state 無しでは音響特徴量デフォルト・onset=false・texture 無し", () => {
    const out = VideoFileInputNode.evaluate(ctxNoState());
    expect(out.audio).toBe(DEFAULT_AUDIO_FEATURES);
    expect(out.volume).toBe(0);
    expect(out.onset).toBe(false);
    expect(out.texture).toBeUndefined();
  });

  test("プレビュー対象である（texture 出力あり）", () => {
    expect(nodeHasPreview(VideoFileInputNode)).toBe(true);
  });

  test("loadFile を持つ（ファイル読込 user gesture 用）", () => {
    expect(typeof VideoFileInputNode.createState).toBe("function");
    expect(VideoFileInputNode.fileInput?.accept).toBe("video/*");
  });
});
