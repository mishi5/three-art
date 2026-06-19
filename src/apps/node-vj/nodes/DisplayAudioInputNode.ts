import type { AudioInput } from "../../../core/audio/AudioInput";
import { DisplayAudioSource } from "../../../core/audio/DisplayAudioSource";
import { DEFAULT_AUDIO_FEATURES } from "../../../core/types";
import type { NodeState, NodeTypeDef } from "../graph/node-type";
import { AUDIO_FEATURE_OUTPUTS, ONSET_PARAMS, LiveAudioRuntime, audioFeatureOutputs, readOnsetParams } from "./audio-feature-logic";
import { SIGNAL_OUTPUT, signalOutput } from "../graph/audio-signal";

/** 画面音声入力の永続状態（getDisplayMedia）。start() は user gesture から呼ぶ。 */
export class DisplayAudioInputRuntime extends LiveAudioRuntime {
  protected createSource(ctx: AudioContext): AudioInput {
    // #128: destination 非接続（タブ自体が鳴っている。signal は Output ノード経由）。
    return new DisplayAudioSource(ctx, { connectToDestination: false });
  }
}

/** 画面音声入力ノード（#100/#128）。audio / 各バンド / onset / signal を出力。 */
export const DisplayAudioInputNode: NodeTypeDef = {
  type: "DisplayAudioInput",
  category: "input",
  description: "画面共有の音声（getDisplayMedia）を入力するノード。audio / 各バンド / onset(trigger) / signal(実音声信号) を出力する。",
  isSink: false,
  inputs: [],
  outputs: [...AUDIO_FEATURE_OUTPUTS, SIGNAL_OUTPUT],
  params: [...ONSET_PARAMS],
  createState: (env) => new DisplayAudioInputRuntime(env.audioContext),
  disposeState: (state: NodeState) => (state as DisplayAudioInputRuntime).dispose(),
  evaluate: (ctx) => {
    const s = ctx.state as DisplayAudioInputRuntime | undefined;
    if (!s) return { ...audioFeatureOutputs(DEFAULT_AUDIO_FEATURES, false), audio: undefined };
    const audio = s.read();
    const { threshold, cooldown } = readOnsetParams(ctx.param);
    return {
      ...audioFeatureOutputs(audio, s.detectOnset(audio.bass, ctx.timeSec, threshold, cooldown)),
      ...signalOutput(s.audioSignalNode()),
    };
  },
};
