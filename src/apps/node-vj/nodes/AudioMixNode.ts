// #127: Audio Mix ノード。複数の signal（audioSignal）を 1 つの GainNode に集約して合成する。
// 合成結果は signal として出力するほか、AudioAnalyzer でタップして音響特徴量も出力する
// （合成音で visual を駆動できる）。共有 AudioContext 上で動作する。
import { AudioAnalyzer } from "../../../core/audio/AudioAnalyzer";
import { DEFAULT_AUDIO_FEATURES } from "../../../core/types";
import type { NodeEnv, NodeState, NodeTypeDef } from "../graph/node-type";
import { AUDIO_FEATURE_OUTPUTS, ONSET_PARAMS, OnsetTracker, audioFeatureOutputs, readOnsetParams } from "./audio-feature-logic";
import { SIGNAL_OUTPUT, asAudioNode, signalOutput } from "../graph/audio-signal";

/** 入力ポート数（複数音声をまとめる）。 */
const MIX_INPUTS = ["in1", "in2", "in3", "in4"] as const;

interface AudioMixState {
  ctx: AudioContext;
  /** 合成バス（= signal 出力 / 解析タップ元）。 */
  mixGain: GainNode;
  analyzer: AudioAnalyzer;
  onset: OnsetTracker;
  /** mixGain に接続済みの入力 AudioNode 集合（差分のみ繋ぎ替え）。 */
  connected: Set<AudioNode>;
}

/** Audio Mix ノード（#127）。複数 signal を合成し、signal + 音響特徴量を出力。 */
export const AudioMixNode: NodeTypeDef = {
  type: "AudioMix",
  category: "process",
  description: "複数の signal（実音声信号）を 1 つに合成するノード。合成した signal を出力し、その音響特徴量（audio/各バンド/onset）も出力する。",
  isSink: false,
  inputs: MIX_INPUTS.map((id, i) => ({
    id, label: id, type: "audioSignal" as const,
    description: `合成する音声信号 ${i + 1}。`,
  })),
  outputs: [SIGNAL_OUTPUT, ...AUDIO_FEATURE_OUTPUTS],
  params: [
    { id: "gain", label: "gain", kind: "number", default: 1, min: 0, max: 2, step: 0.01, description: "合成後のマスタゲイン（0〜2）。" },
    ...ONSET_PARAMS,
  ],
  createState(env: NodeEnv): AudioMixState {
    const ctx = env.audioContext;
    const mixGain = ctx.createGain();
    const analyzer = new AudioAnalyzer(ctx);
    // 合成バスを解析タップへ（発音は Audio 出力ノード経由）。
    mixGain.connect(analyzer.input);
    // #128: 無音(gain 0)の keep-alive で解析グラフを生かす（合成音の特徴量を出すため）。
    const keep = ctx.createGain();
    keep.gain.value = 0;
    mixGain.connect(keep);
    keep.connect(ctx.destination);
    return { ctx, mixGain, analyzer, onset: new OnsetTracker(), connected: new Set() };
  },
  disposeState(state: NodeState): void {
    const st = state as AudioMixState;
    for (const n of st.connected) { try { n.disconnect(st.mixGain); } catch { /* ignore */ } }
    try { st.mixGain.disconnect(); } catch { /* ignore */ }
  },
  evaluate(ctx) {
    const st = ctx.state as AudioMixState | undefined;
    if (!st) return { signal: undefined, ...audioFeatureOutputs(DEFAULT_AUDIO_FEATURES, false) };

    // 入力 signal を収集し、mixGain への接続を差分更新する。
    const wanted = new Set<AudioNode>();
    for (const id of MIX_INPUTS) {
      const node = asAudioNode(ctx.input(id));
      if (node) wanted.add(node);
    }
    for (const n of [...st.connected]) {
      if (!wanted.has(n)) { try { n.disconnect(st.mixGain); } catch { /* ignore */ } st.connected.delete(n); }
    }
    for (const n of wanted) {
      if (!st.connected.has(n)) { n.connect(st.mixGain); st.connected.add(n); }
    }

    st.mixGain.gain.value = Number(ctx.param("gain") ?? 1);
    const audio = st.analyzer.read(st.ctx.sampleRate);
    const { threshold, cooldown } = readOnsetParams(ctx.param);
    const onset = st.onset.detect(audio.bass, ctx.timeSec, threshold, cooldown);
    return { ...signalOutput(st.mixGain), ...audioFeatureOutputs(audio, onset) };
  },
};
