import { expect, test, describe } from "bun:test";
import { AUDIO_FEATURE_OUTPUTS, audioFeatureOutputs, OnsetTracker } from "./audio-feature-logic";
import { DEFAULT_AUDIO_FEATURES, type AudioFeatures } from "../../../core/types";

describe("audio-feature-logic (#100)", () => {
  test("AUDIO_FEATURE_OUTPUTS: id 順と型（section は含めない）", () => {
    expect(AUDIO_FEATURE_OUTPUTS.map((p) => `${p.id}:${p.type}`)).toEqual([
      "audio:audio",
      "volume:number",
      "bass:number",
      "mid:number",
      "treble:number",
      "onset:trigger",
    ]);
  });

  test("audioFeatureOutputs: audio とバンドを展開し onset を付与", () => {
    const audio: AudioFeatures = { ...DEFAULT_AUDIO_FEATURES, volume: 0.3, bass: 0.4, mid: 0.5, treble: 0.6 };
    expect(audioFeatureOutputs(audio, true)).toEqual({
      audio, volume: 0.3, bass: 0.4, mid: 0.5, treble: 0.6, onset: true,
    });
  });

  // 既存 AudioInput の挙動を忠実に踏襲（getWaveTimes().length は常に 4 のため
  // 初回フレームで true・以降 false になる既知の挙動）。
  test("OnsetTracker: 初回 detect で true、以降は false", () => {
    const t = new OnsetTracker();
    expect(t.detect(0.5, 0)).toBe(true);
    expect(t.detect(0.5, 0.2)).toBe(false);
    expect(t.detect(0.0, 0.4)).toBe(false);
  });
});
