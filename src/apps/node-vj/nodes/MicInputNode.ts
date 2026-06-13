import type { AudioInput } from "../../../core/audio/AudioInput";
import { MicAudioSource } from "../../../core/audio/MicAudioSource";
import { DEFAULT_AUDIO_FEATURES } from "../../../core/types";
import type { NodeState, NodeTypeDef } from "../graph/node-type";
import { AUDIO_FEATURE_OUTPUTS, LiveAudioRuntime, audioFeatureOutputs } from "./audio-feature-logic";

/** マイク入力の永続状態。start() は user gesture から呼ぶ。 */
export class MicInputRuntime extends LiveAudioRuntime {
  protected createSource(ctx: AudioContext): AudioInput {
    return new MicAudioSource(ctx);
  }
}

/** マイク入力ノード（#100）。audio / 各バンド(number) / onset(trigger) を出力。 */
export const MicInputNode: NodeTypeDef = {
  type: "MicInput",
  category: "input",
  isSink: false,
  inputs: [],
  outputs: AUDIO_FEATURE_OUTPUTS,
  params: [],
  createState: () => new MicInputRuntime(),
  disposeState: (state: NodeState) => (state as MicInputRuntime).dispose(),
  evaluate: (ctx) => {
    const s = ctx.state as MicInputRuntime | undefined;
    if (!s) return audioFeatureOutputs(DEFAULT_AUDIO_FEATURES, false);
    const audio = s.read();
    return audioFeatureOutputs(audio, s.detectOnset(audio.bass, ctx.timeSec));
  },
};
