import { expect, test, describe } from "bun:test";
import { AudioOutputNode } from "./AudioOutputNode";
import { AudioMixNode } from "./AudioMixNode";
import { nodeHasPreview } from "../editor/NodeEditor";
import { isCompatible } from "../graph/port-types";
import { signalOutput, asAudioNode } from "../graph/audio-signal";
import type { EvalContext } from "../graph/node-type";
import { DEFAULT_AUDIO_FEATURES } from "../../../core/types";

function ctxNoState(over: Partial<EvalContext> = {}): EvalContext {
  return {
    timeSec: 0,
    input: () => undefined,
    param: () => undefined,
    node: { id: "x", type: "T", params: {} },
    ...over,
  };
}

describe("audio-signal ヘルパ", () => {
  test("signalOutput(null) は signal=undefined", () => {
    expect(signalOutput(null)).toEqual({ signal: undefined });
  });
  test("signalOutput(node) は { signal: { node } }", () => {
    const fake = { kind: "audionode" } as unknown as AudioNode;
    expect(signalOutput(fake)).toEqual({ signal: { node: fake } });
  });
  test("asAudioNode は signal 値から node を取り出す", () => {
    const fake = { kind: "audionode" } as unknown as AudioNode;
    expect(asAudioNode({ node: fake })).toBe(fake);
    expect(asAudioNode(undefined)).toBeNull();
    expect(asAudioNode(null)).toBeNull();
  });
});

describe("AudioOutputNode (#128 sink)", () => {
  test("type/category/isSink", () => {
    expect(AudioOutputNode.type).toBe("AudioOutput");
    expect(AudioOutputNode.category).toBe("output");
    expect(AudioOutputNode.isSink).toBe(true);
  });

  test("入力 signal(audioSignal)・出力なし", () => {
    expect(AudioOutputNode.inputs.map((p) => p.id)).toEqual(["signal"]);
    expect(AudioOutputNode.inputs[0]!.type).toBe("audioSignal");
    expect(AudioOutputNode.outputs).toEqual([]);
  });

  test("params: volume / mute", () => {
    expect(AudioOutputNode.params.map((p) => p.id)).toEqual(["volume", "mute"]);
    const mute = AudioOutputNode.params.find((p) => p.id === "mute");
    expect(mute?.options).toEqual(["off", "on"]);
  });

  test("state 無しの evaluate は安全（空オブジェクト）", () => {
    expect(AudioOutputNode.evaluate(ctxNoState())).toEqual({});
  });

  test("プレビュー対象でない", () => {
    expect(nodeHasPreview(AudioOutputNode)).toBe(false);
  });
});

describe("AudioMixNode (#127)", () => {
  test("type/category", () => {
    expect(AudioMixNode.type).toBe("AudioMix");
    expect(AudioMixNode.category).toBe("process");
  });

  test("複数 signal 入力（in1..in4, audioSignal）", () => {
    expect(AudioMixNode.inputs.map((p) => p.id)).toEqual(["in1", "in2", "in3", "in4"]);
    for (const p of AudioMixNode.inputs) expect(p.type).toBe("audioSignal");
  });

  test("出力: signal + 音響特徴量", () => {
    expect(AudioMixNode.outputs.map((p) => p.id)).toEqual([
      "signal", "audio", "volume", "bass", "mid", "treble", "onset",
    ]);
    expect(AudioMixNode.outputs.find((p) => p.id === "signal")?.type).toBe("audioSignal");
  });

  test("params: gain + onset", () => {
    expect(AudioMixNode.params.map((p) => p.id)).toEqual(["gain", "onsetThreshold", "onsetCooldown"]);
  });

  test("state 無しの evaluate は安全デフォルト（signal なし・onset false）", () => {
    const out = AudioMixNode.evaluate(ctxNoState());
    expect(out.signal).toBeUndefined();
    expect(out.audio).toBe(DEFAULT_AUDIO_FEATURES);
    expect(out.onset).toBe(false);
  });
});

describe("audioSignal ポート互換", () => {
  test("audioSignal 同士のみ接続可", () => {
    expect(isCompatible("audioSignal", "audioSignal")).toBe(true);
    expect(isCompatible("audioSignal", "audio")).toBe(false);
  });
});
