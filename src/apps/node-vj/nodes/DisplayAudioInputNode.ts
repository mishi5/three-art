import type { AudioInput } from "../../../core/audio/AudioInput";
import { DisplayAudioSource } from "../../../core/audio/DisplayAudioSource";
import { DEFAULT_AUDIO_FEATURES } from "../../../core/types";
import type { NodeState, NodeTypeDef } from "../graph/node-type";
import { AUDIO_FEATURE_OUTPUTS, LiveAudioRuntime, audioFeatureOutputs } from "./audio-feature-logic";

/** 画面音声入力の永続状態（getDisplayMedia）。start() は user gesture から呼ぶ。 */
export class DisplayAudioInputRuntime extends LiveAudioRuntime {
  protected createSource(ctx: AudioContext): AudioInput {
    return new DisplayAudioSource(ctx);
  }
}

/** 画面音声入力ノード（#100）。audio / 各バンド(number) / onset(trigger) を出力。 */
export const DisplayAudioInputNode: NodeTypeDef = {
  type: "DisplayAudioInput",
  category: "input",
  isSink: false,
  inputs: [],
  outputs: AUDIO_FEATURE_OUTPUTS,
  params: [],
  createState: () => new DisplayAudioInputRuntime(),
  disposeState: (state: NodeState) => (state as DisplayAudioInputRuntime).dispose(),
  evaluate: (ctx) => {
    const s = ctx.state as DisplayAudioInputRuntime | undefined;
    if (!s) return audioFeatureOutputs(DEFAULT_AUDIO_FEATURES, false);
    const audio = s.read();
    return audioFeatureOutputs(audio, s.detectOnset(audio.bass, ctx.timeSec));
  },
};
