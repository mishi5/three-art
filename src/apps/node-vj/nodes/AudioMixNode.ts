// #127: Audio Mix ノード（ミキサー）。複数の audio（実音声信号）を、入力ごとの
// レベル（音量バランス）を調整しながら 1 つに合成する。合成結果は audio として出力し、
// AudioAnalyzer でタップして音響特徴量（signal）も出力する（合成音で visual を駆動できる）。
// 共有 AudioContext 上で動作する。
import { AudioAnalyzer } from "../../../core/audio/AudioAnalyzer";
import { DEFAULT_AUDIO_FEATURES } from "../../../core/types";
import type { NodeEnv, NodeState, NodeTypeDef } from "../graph/node-type";
import { AUDIO_FEATURE_OUTPUTS, ONSET_PARAMS, OnsetTracker, audioFeatureOutputs, readOnsetParams } from "./audio-feature-logic";
import { SIGNAL_OUTPUT, asAudioNode, signalOutput } from "../graph/audio-signal";

/** 入力ポート（複数音声をまとめる）。各入力に対応する level{n} param を持つ。 */
const MIX_INPUTS = ["in1", "in2", "in3", "in4"] as const;
const levelParam = (i: number): string => `level${i + 1}`;

/** 1 入力チャンネル: 入力 AudioNode → チャンネルゲイン → mixGain。 */
interface MixChannel {
  /** このチャンネルの音量ゲイン（level{n} で制御）。 */
  gain: GainNode;
  /** gain に現在接続済みの入力 AudioNode（変化時のみ繋ぎ替え）。 */
  connected: AudioNode | null;
}

interface AudioMixState {
  ctx: AudioContext;
  /** 合成バス（= audio 出力 / 解析タップ元）。 */
  mixGain: GainNode;
  channels: MixChannel[];
  analyzer: AudioAnalyzer;
  onset: OnsetTracker;
}

/** Audio Mix ノード（#127）。各入力レベルを調整して合成し、audio + 音響特徴量を出力。 */
export const AudioMixNode: NodeTypeDef = {
  type: "AudioMix",
  category: "process",
  description: "ミキサー。複数の実音声(audio)を入力ごとの level で音量調整しながら合成する。合成した audio を出力し、その音響特徴量(signal)も出力する。",
  isSink: false,
  inputs: MIX_INPUTS.map((id, i) => ({
    id, label: id, type: "audio" as const,
    description: `合成する音声 ${i + 1}。level${i + 1} で音量を調整。`,
  })),
  outputs: [SIGNAL_OUTPUT, ...AUDIO_FEATURE_OUTPUTS],
  params: [
    ...MIX_INPUTS.map((_id, i) => ({
      id: levelParam(i), label: levelParam(i), kind: "number" as const,
      default: 1, min: 0, max: 2, step: 0.01,
      description: `入力 ${i + 1}（in${i + 1}）の音量（0=ミュート, 1=等倍, 2=増幅）。`,
    })),
    { id: "gain", label: "gain", kind: "number", default: 1, min: 0, max: 2, step: 0.01, description: "合成後のマスタゲイン（0〜2）。" },
    ...ONSET_PARAMS,
  ],
  createState(env: NodeEnv): AudioMixState {
    const ctx = env.audioContext;
    const mixGain = ctx.createGain();
    const channels: MixChannel[] = MIX_INPUTS.map(() => {
      const gain = ctx.createGain();
      gain.connect(mixGain);
      return { gain, connected: null };
    });
    const analyzer = new AudioAnalyzer(ctx);
    // 合成バスを解析タップへ（発音は Audio 出力ノード経由）。
    mixGain.connect(analyzer.input);
    // #128: 無音(gain 0)の keep-alive で解析グラフを生かす（合成音の特徴量を出すため）。
    const keep = ctx.createGain();
    keep.gain.value = 0;
    mixGain.connect(keep);
    keep.connect(ctx.destination);
    return { ctx, mixGain, channels, analyzer, onset: new OnsetTracker() };
  },
  disposeState(state: NodeState): void {
    const st = state as AudioMixState;
    for (const ch of st.channels) {
      try { ch.connected?.disconnect(ch.gain); } catch { /* ignore */ }
      try { ch.gain.disconnect(); } catch { /* ignore */ }
    }
    try { st.mixGain.disconnect(); } catch { /* ignore */ }
  },
  evaluate(ctx) {
    const st = ctx.state as AudioMixState | undefined;
    if (!st) return { audio: undefined, ...audioFeatureOutputs(DEFAULT_AUDIO_FEATURES, false) };

    // 各入力チャンネル: 接続を差分更新し、level でゲインを設定する。
    MIX_INPUTS.forEach((id, i) => {
      const ch = st.channels[i]!;
      const node = asAudioNode(ctx.input(id));
      if (node !== ch.connected) {
        if (ch.connected) { try { ch.connected.disconnect(ch.gain); } catch { /* ignore */ } }
        if (node) node.connect(ch.gain);
        ch.connected = node;
      }
      ch.gain.gain.value = Number(ctx.param(levelParam(i)) ?? 1);
    });

    st.mixGain.gain.value = Number(ctx.param("gain") ?? 1);
    const audio = st.analyzer.read(st.ctx.sampleRate);
    const { threshold, cooldown } = readOnsetParams(ctx.param);
    const onset = st.onset.detect(audio.bass, ctx.timeSec, threshold, cooldown);
    return { ...signalOutput(st.mixGain), ...audioFeatureOutputs(audio, onset) };
  },
};
