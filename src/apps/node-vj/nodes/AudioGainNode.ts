// #239: 音声ゲイン（GainNode）。audio の音量を調整して出力する。
// gain は数値 param（＝入力ポート化されるので Envelope 等の number 出力で駆動でき、
// フェード/ダッキングに使える）。setTargetAtTime で滑らかに追従させ、クリックノイズを避ける。
import type { NodeEnv, NodeState, NodeTypeDef } from "../graph/node-type";
import { SIGNAL_OUTPUT, asAudioNode, signalOutput } from "../graph/audio-signal";
import { applySmoothParam, readNumberParam } from "./audio-effect-logic";

interface AudioGainState {
  ctx: AudioContext;
  gain: GainNode;
  /** gain に接続済みの入力 AudioNode（変化時のみ繋ぎ替え）。 */
  connected: AudioNode | null;
  /** setTargetAtTime を積みすぎないための前回適用値。 */
  lastGain: number | null;
}

/** 音声ゲインノード（#239）。audio の音量を gain（0〜2）で調整して出力する。 */
export const AudioGainNode: NodeTypeDef = {
  type: "AudioGain",
  category: "audio",
  description: "node.AudioGain.desc",
  isSink: false,
  inputs: [{ id: "audio", label: "audio", type: "audio", description: "node.AudioGain.port.audio" }],
  outputs: [SIGNAL_OUTPUT],
  params: [
    { id: "enabled", label: "enabled", kind: "enum", default: "on", options: ["on", "off"], description: "node.AudioGain.param.enabled" },
    { id: "gain", label: "gain", kind: "number", default: 1, min: 0, max: 2, step: 0.01, description: "node.AudioGain.param.gain" },
  ],
  createState(env: NodeEnv): AudioGainState {
    const ctx = env.audioContext;
    return { ctx, gain: ctx.createGain(), connected: null, lastGain: null };
  },
  disposeState(state: NodeState): void {
    const st = state as AudioGainState;
    try { st.connected?.disconnect(st.gain); } catch { /* already disconnected */ }
    try { st.gain.disconnect(); } catch { /* ignore */ }
  },
  evaluate(ctx) {
    const st = ctx.state as AudioGainState | undefined;
    if (!st) return signalOutput(null);
    // 入力が変わったときだけ繋ぎ替える（論理切断＝物理 disconnect・#198）。
    // enabled=off はエフェクトへ繋がず（処理も止める）、入力をそのまま出力するパススルー。
    const enabled = ctx.param("enabled") !== "off";
    const node = asAudioNode(ctx.input("audio"));
    const target = enabled ? node : null;
    if (target !== st.connected) {
      if (st.connected) { try { st.connected.disconnect(st.gain); } catch { /* ignore */ } }
      if (target) target.connect(st.gain);
      st.connected = target;
    }
    if (!enabled) return signalOutput(node);
    st.lastGain = applySmoothParam(st.gain.gain, st.lastGain, readNumberParam(ctx.param("gain"), 0, 2, 1), st.ctx.currentTime);
    return signalOutput(st.gain);
  },
};
