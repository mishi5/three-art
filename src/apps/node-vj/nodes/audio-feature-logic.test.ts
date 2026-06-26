import { expect, test, describe } from "bun:test";
import {
  AUDIO_FEATURE_OUTPUTS, audioFeatureOutputs, OnsetTracker,
  DEFAULT_ONSET_THRESHOLD as THR, DEFAULT_ONSET_COOLDOWN as CD,
} from "./audio-feature-logic";
import { DEFAULT_AUDIO_FEATURES, type AudioFeatures } from "../../../core/types";

describe("audio-feature-logic (#100)", () => {
  test("AUDIO_FEATURE_OUTPUTS: id 順と型（section は含めない・#127/#128 でバンドルは signal）", () => {
    expect(AUDIO_FEATURE_OUTPUTS.map((p) => `${p.id}:${p.type}`)).toEqual([
      "signal:signal",
      "volume:number",
      "bass:number",
      "mid:number",
      "treble:number",
      "trigger:trigger",
    ]);
  });

  test("audioFeatureOutputs: signal(バンドル) とバンドを展開し trigger を付与", () => {
    const audio: AudioFeatures = { ...DEFAULT_AUDIO_FEATURES, volume: 0.3, bass: 0.4, mid: 0.5, treble: 0.6 };
    expect(audioFeatureOutputs(audio, true)).toEqual({
      signal: audio, volume: 0.3, bass: 0.4, mid: 0.5, treble: 0.6, trigger: true,
    });
  });

  // #107: 新規 onset が発火したフレームのみ true を返す（音と無関係な誤発火をしない）。
  test("OnsetTracker: 無音では false（初回フレーム含む）", () => {
    const t = new OnsetTracker();
    expect(t.detect(0.0, 0, THR, CD)).toBe(false);
    expect(t.detect(0.0, 0.1, THR, CD)).toBe(false);
  });

  test("OnsetTracker: bass の立ち上がりフレームのみ true・定常は false", () => {
    const t = new OnsetTracker();
    expect(t.detect(0.0, 0.0, THR, CD)).toBe(false);   // prime
    expect(t.detect(0.5, 0.1, THR, CD)).toBe(true);    // delta>threshold で発火
    expect(t.detect(0.5, 0.2, THR, CD)).toBe(false);   // 定常（delta=0）
    expect(t.detect(0.5, 0.3, THR, CD)).toBe(false);
  });

  test("OnsetTracker: cooldown 経過後の再立ち上がりで再び true", () => {
    const t = new OnsetTracker();
    t.detect(0.0, 0.0, THR, CD);                        // prime
    expect(t.detect(0.5, 0.1, THR, CD)).toBe(true);    // 発火 @ 0.1
    expect(t.detect(0.0, 0.3, THR, CD)).toBe(false);   // 立ち下がり
    expect(t.detect(0.5, 0.4, THR, CD)).toBe(true);    // cooldown(0.12) 経過後に再発火
  });
});
