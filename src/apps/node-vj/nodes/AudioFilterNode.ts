// #239: 音声フィルタ（BiquadFilterNode）。audio を lowpass/highpass/bandpass で加工する。
// frequency/Q は数値 param（＝入力ポート化されるので LFO 等の number 出力で駆動できる）。
// AudioParam は setTargetAtTime で滑らかに追従させ、クリックノイズを避ける。
import type { NodeEnv, NodeState, NodeTypeDef } from "../graph/node-type";
import { SIGNAL_OUTPUT, asAudioNode, signalOutput } from "../graph/audio-signal";
import { FILTER_TYPES, applySmoothParam, readFilterType, readNumberParam } from "./audio-effect-logic";

interface AudioFilterState {
  ctx: AudioContext;
  filter: BiquadFilterNode;
  /** filter に接続済みの入力 AudioNode（変化時のみ繋ぎ替え）。 */
  connected: AudioNode | null;
  /** setTargetAtTime を積みすぎないための前回適用値。 */
  lastFrequency: number | null;
  lastQ: number | null;
}

/** 音声フィルタノード（#239）。audio を BiquadFilter で加工して出力する。 */
export const AudioFilterNode: NodeTypeDef = {
  type: "AudioFilter",
  category: "process",
  description: "音声フィルタ。audio を lowpass/highpass/bandpass で加工する。frequency を Sine 等の number 出力で振ると音が動く。",
  isSink: false,
  inputs: [{ id: "audio", label: "audio", type: "audio", description: "加工する実音声信号。" }],
  outputs: [SIGNAL_OUTPUT],
  params: [
    { id: "type", label: "type", kind: "enum", default: "lowpass", options: [...FILTER_TYPES], description: "フィルタ種別（lowpass=低域通過, highpass=高域通過, bandpass=帯域通過）。" },
    { id: "frequency", label: "frequency", kind: "number", default: 1000, min: 20, max: 20000, step: 1, description: "カットオフ/中心周波数（Hz）。聴感は対数的なので低域は細かく・高域は大きく動かすとよい。" },
    { id: "Q", label: "Q", kind: "number", default: 1, min: 0.1, max: 20, step: 0.1, description: "レゾナンス（カットオフ付近の尖り）。大きいほどクセの強い音になる。" },
  ],
  createState(env: NodeEnv): AudioFilterState {
    const ctx = env.audioContext;
    return { ctx, filter: ctx.createBiquadFilter(), connected: null, lastFrequency: null, lastQ: null };
  },
  disposeState(state: NodeState): void {
    const st = state as AudioFilterState;
    try { st.connected?.disconnect(st.filter); } catch { /* already disconnected */ }
    try { st.filter.disconnect(); } catch { /* ignore */ }
  },
  evaluate(ctx) {
    const st = ctx.state as AudioFilterState | undefined;
    if (!st) return signalOutput(null);
    // 入力が変わったときだけ繋ぎ替える（論理切断＝物理 disconnect・#198）。
    const node = asAudioNode(ctx.input("audio"));
    if (node !== st.connected) {
      if (st.connected) { try { st.connected.disconnect(st.filter); } catch { /* ignore */ } }
      if (node) node.connect(st.filter);
      st.connected = node;
    }
    st.filter.type = readFilterType(ctx.param("type"));
    const now = st.ctx.currentTime;
    st.lastFrequency = applySmoothParam(st.filter.frequency, st.lastFrequency, readNumberParam(ctx.param("frequency"), 20, 20000, 1000), now);
    st.lastQ = applySmoothParam(st.filter.Q, st.lastQ, readNumberParam(ctx.param("Q"), 0.1, 20, 1), now);
    return signalOutput(st.filter);
  },
};
