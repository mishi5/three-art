import { expect, test, describe } from "bun:test";
import { PoseInputNode } from "./PoseInputNode";
import { AudioInputNode } from "./AudioInputNode";
import { RainVisualNode } from "./RainVisualNode";
import type { EvalContext } from "../graph/node-type";
import { DEFAULT_AUDIO_FEATURES } from "../../../core/types";

// state なしの evaluate でも安全なデフォルトを返すことを確認（headless）。
function ctxNoState(over: Partial<EvalContext> = {}): EvalContext {
  return {
    timeSec: 0,
    input: () => undefined,
    param: (id) => (id === "source" ? "mic" : undefined),
    node: { id: "x", type: "T", params: {} },
    ...over,
  };
}

describe("PoseInputNode", () => {
  test("ポート定義: pose と motion を出力", () => {
    expect(PoseInputNode.outputs.map((p) => p.id)).toEqual(["pose", "motion"]);
    expect(PoseInputNode.outputs.find((p) => p.id === "pose")?.type).toBe("pose");
  });

  test("state 無しでも空 pose と motion=0 を返す", () => {
    const out = PoseInputNode.evaluate(ctxNoState());
    expect(out.motion).toBe(0);
    const pose = out.pose as { joints: Float32Array };
    expect(pose.joints.length).toBe(13 * 3);
  });
});

describe("AudioInputNode", () => {
  test("ポート定義: audio/bands/onset/section", () => {
    const ids = AudioInputNode.outputs.map((p) => p.id);
    expect(ids).toEqual(["audio", "volume", "bass", "mid", "treble", "onset", "section"]);
    expect(AudioInputNode.outputs.find((p) => p.id === "audio")?.type).toBe("audio");
    expect(AudioInputNode.outputs.find((p) => p.id === "onset")?.type).toBe("trigger");
  });

  test("state 無しでは section=-1, onset=false, デフォルト audio", () => {
    const out = AudioInputNode.evaluate(ctxNoState());
    expect(out.section).toBe(-1);
    expect(out.onset).toBe(false);
    expect(out.audio).toBe(DEFAULT_AUDIO_FEATURES);
  });
});

describe("RainVisualNode", () => {
  test("audio 入力ポートを持つ", () => {
    expect(RainVisualNode.inputs.map((p) => p.id)).toContain("audio");
    expect(RainVisualNode.inputs.find((p) => p.id === "audio")?.type).toBe("audio");
  });

  test("state/env 無しでは no-op（空オブジェクト）", () => {
    expect(RainVisualNode.evaluate(ctxNoState())).toEqual({});
  });
});

import { nodeHasPreview } from "../editor/NodeEditor";

describe("PoseInput プレビュー (#79)", () => {
  test("previewSource と skeleton param を持つ", () => {
    expect(typeof PoseInputNode.previewSource).toBe("function");
    const sk = PoseInputNode.params.find((p) => p.id === "skeleton");
    expect(sk?.kind).toBe("enum");
    expect(sk?.default).toBe("off");
    expect(sk?.options).toEqual(["off", "on"]);
  });

  test("nodeHasPreview: texture 出力 or previewSource", () => {
    expect(nodeHasPreview(PoseInputNode)).toBe(true);   // previewSource
    expect(nodeHasPreview(RainVisualNode)).toBe(true);  // texture 出力
    expect(nodeHasPreview(AudioInputNode)).toBe(false); // どちらもなし
  });
});
