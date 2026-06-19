import { expect, test, describe } from "bun:test";
import { CameraInputNode } from "./CameraInputNode";
import { VideoFileInputNode } from "./VideoFileInputNode";
import { RainVisualNode } from "./RainVisualNode";
import type { EvalContext } from "../graph/node-type";

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

describe("CameraInputNode (#66)", () => {
  test("ポート定義: texture/pose/motion を出力", () => {
    expect(CameraInputNode.outputs.map((p) => p.id)).toEqual(["texture", "pose", "motion"]);
    expect(CameraInputNode.outputs.find((p) => p.id === "texture")?.type).toBe("texture");
    expect(CameraInputNode.outputs.find((p) => p.id === "pose")?.type).toBe("pose");
  });

  test("params: poseDetect(on/off) と skeleton(off/on) のプルダウン", () => {
    const pd = CameraInputNode.params.find((p) => p.id === "poseDetect");
    expect(pd?.kind).toBe("enum");
    expect(pd?.default).toBe("on");
    const sk = CameraInputNode.params.find((p) => p.id === "skeleton");
    expect(sk?.options).toEqual(["off", "on"]);
  });

  test("state 無しでも空 pose と motion=0 を返す", () => {
    const out = CameraInputNode.evaluate(ctxNoState());
    expect(out.motion).toBe(0);
    const pose = out.pose as { joints: Float32Array };
    expect(pose.joints.length).toBe(13 * 3);
  });
});

describe("VideoFileInputNode (#66/#116)", () => {
  test("ポート定義: texture 出力・loop param（音声出力は #116 で追加）", () => {
    expect(VideoFileInputNode.outputs.map((p) => p.id)).toContain("texture");
    expect(VideoFileInputNode.outputs.find((p) => p.id === "texture")?.type).toBe("texture");
    const loop = VideoFileInputNode.params.find((p) => p.id === "loop");
    expect(loop?.options).toEqual(["on", "off"]);
    expect(typeof VideoFileInputNode.previewSource).toBe("function");
  });

  test("state 無しでも音響特徴量デフォルトを返す（#116, texture は無し）", () => {
    const out = VideoFileInputNode.evaluate(ctxNoState());
    expect(out.texture).toBeUndefined();
    expect(out.onset).toBe(false);
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

describe("プレビュー対象判定 (#79/#66)", () => {
  test("nodeHasPreview: texture 出力 or previewSource", () => {
    expect(nodeHasPreview(CameraInputNode)).toBe(true);    // 両方
    expect(nodeHasPreview(VideoFileInputNode)).toBe(true); // 両方
    expect(nodeHasPreview(RainVisualNode)).toBe(true);     // texture 出力
  });
});
