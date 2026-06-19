import type { AudioInput } from "../../../core/audio/AudioInput";
import { DisplayAudioSource } from "../../../core/audio/DisplayAudioSource";
import { DEFAULT_AUDIO_FEATURES } from "../../../core/types";
import type { NodeState, NodeTypeDef } from "../graph/node-type";
import { AUDIO_FEATURE_OUTPUTS, ONSET_PARAMS, LiveAudioRuntime, audioFeatureOutputs, readOnsetParams } from "./audio-feature-logic";

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
  description: "画面共有の音声（getDisplayMedia）を入力するノード。audio / 各バンド / onset(trigger) を出力する。",
  isSink: false,
  inputs: [],
  outputs: AUDIO_FEATURE_OUTPUTS,
  params: [...ONSET_PARAMS],
  createState: () => new DisplayAudioInputRuntime(),
  disposeState: (state: NodeState) => (state as DisplayAudioInputRuntime).dispose(),
  evaluate: (ctx) => {
    const s = ctx.state as DisplayAudioInputRuntime | undefined;
    if (!s) return audioFeatureOutputs(DEFAULT_AUDIO_FEATURES, false);
    const audio = s.read();
    const { threshold, cooldown } = readOnsetParams(ctx.param);
    return audioFeatureOutputs(audio, s.detectOnset(audio.bass, ctx.timeSec, threshold, cooldown));
  },
};
