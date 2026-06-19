import type { AudioInput } from "../../../core/audio/AudioInput";
import { MicAudioSource } from "../../../core/audio/MicAudioSource";
import { DEFAULT_AUDIO_FEATURES } from "../../../core/types";
import type { NodeState, NodeTypeDef } from "../graph/node-type";
import { AUDIO_FEATURE_OUTPUTS, ONSET_PARAMS, LiveAudioRuntime, audioFeatureOutputs, readOnsetParams } from "./audio-feature-logic";
import { SIGNAL_OUTPUT, signalOutput } from "../graph/audio-signal";

/** マイク入力の永続状態。start() は user gesture から呼ぶ。 */
export class MicInputRuntime extends LiveAudioRuntime {
  protected createSource(ctx: AudioContext): AudioInput {
    // #128: destination 非接続。signal を Audio 出力ノード経由で鳴らす。
    return new MicAudioSource(ctx, { connectToDestination: false });
  }
}

/** マイク入力ノード（#100/#128）。audio / 各バンド / onset / signal を出力。 */
export const MicInputNode: NodeTypeDef = {
  type: "MicInput",
  category: "input",
  description: "マイク音声を入力するノード。audio / 各バンド(volume/bass/mid/treble) / onset(trigger) / signal(実音声信号) を出力する。",
  isSink: false,
  inputs: [],
  outputs: [...AUDIO_FEATURE_OUTPUTS, SIGNAL_OUTPUT],
  params: [...ONSET_PARAMS],
  createState: (env) => new MicInputRuntime(env.audioContext),
  disposeState: (state: NodeState) => (state as MicInputRuntime).dispose(),
  evaluate: (ctx) => {
    const s = ctx.state as MicInputRuntime | undefined;
    if (!s) return { ...audioFeatureOutputs(DEFAULT_AUDIO_FEATURES, false), signal: undefined };
    const audio = s.read();
    const { threshold, cooldown } = readOnsetParams(ctx.param);
    return {
      ...audioFeatureOutputs(audio, s.detectOnset(audio.bass, ctx.timeSec, threshold, cooldown)),
      ...signalOutput(s.audioSignalNode()),
    };
  },
};
