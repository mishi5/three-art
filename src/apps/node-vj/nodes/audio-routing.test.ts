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
  test("signalOutput(null) は audio=undefined（実音声ポートは \"audio\"）", () => {
    expect(signalOutput(null)).toEqual({ audio: undefined });
  });
  test("signalOutput(node) は { audio: { node } }", () => {
    const fake = { kind: "audionode" } as unknown as AudioNode;
    expect(signalOutput(fake)).toEqual({ audio: { node: fake } });
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

  test("入力 audio(実音声信号)・出力なし", () => {
    expect(AudioOutputNode.inputs.map((p) => p.id)).toEqual(["audio"]);
    expect(AudioOutputNode.inputs[0]!.type).toBe("audio");
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

  test("複数 audio 入力（in1..in4, 実音声信号）", () => {
    expect(AudioMixNode.inputs.map((p) => p.id)).toEqual(["in1", "in2", "in3", "in4"]);
    for (const p of AudioMixNode.inputs) expect(p.type).toBe("audio");
  });

  test("出力: audio(合成音) + 音響特徴量(signal)", () => {
    expect(AudioMixNode.outputs.map((p) => p.id)).toEqual([
      "audio", "signal", "volume", "bass", "mid", "treble", "trigger",
    ]);
    expect(AudioMixNode.outputs.find((p) => p.id === "audio")?.type).toBe("audio");
    expect(AudioMixNode.outputs.find((p) => p.id === "signal")?.type).toBe("signal");
  });

  test("params: 各入力 level1..4 + マスタ gain + onset（ミキサー）", () => {
    expect(AudioMixNode.params.map((p) => p.id)).toEqual([
      "level1", "level2", "level3", "level4", "gain", "onsetThreshold", "onsetCooldown",
    ]);
    const l1 = AudioMixNode.params.find((p) => p.id === "level1");
    expect(l1?.kind).toBe("number");
    expect(l1?.default).toBe(1);
  });

  test("state 無しの evaluate は安全デフォルト（audio なし・signal=デフォルト・trigger false）", () => {
    const out = AudioMixNode.evaluate(ctxNoState());
    expect(out.audio).toBeUndefined();
    expect(out.signal).toBe(DEFAULT_AUDIO_FEATURES);
    expect(out.trigger).toBe(false);
  });
});

describe("audio ポート互換", () => {
  test("実音声 audio 同士のみ接続可・特徴量 signal とは非互換", () => {
    expect(isCompatible("audio", "audio")).toBe(true);
    expect(isCompatible("audio", "signal")).toBe(false);
  });
});
