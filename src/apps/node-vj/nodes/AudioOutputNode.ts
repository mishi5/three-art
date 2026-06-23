// #128: Audio 出力ノード（audio sink）。visual の Screen に相当する「音の出口」。
// 入力 signal（audioSignal）を共有 AudioContext の destination へ繋ぐ。接続された音だけが鳴る。
import type { NodeEnv, NodeState, NodeTypeDef } from "../graph/node-type";
import { asAudioNode } from "../graph/audio-signal";

interface AudioOutputState {
  ctx: AudioContext;
  /** destination 直前のゲイン（volume/mute 制御）。 */
  gain: GainNode;
  /** 現在 gain に接続済みの入力 AudioNode（変化時のみ繋ぎ替え）。 */
  connected: AudioNode | null;
}

/** Audio 出力ノード（#128）。signal をスピーカー（destination）へ発音する終端ノード。 */
export const AudioOutputNode: NodeTypeDef = {
  type: "AudioOutput",
  category: "output",
  description: "音の出口（audio sink）。signal を繋ぐとスピーカーから鳴る。繋がれた音だけが発音される（visual の Screen と同じ思想）。",
  isSink: true,
  inputs: [{ id: "audio", label: "audio", type: "audio", description: "発音する実音声信号。Mic/AudioFile/Video/Mix の audio を繋ぐ。" }],
  outputs: [],
  params: [
    { id: "volume", label: "volume", kind: "number", default: 1, min: 0, max: 1, step: 0.01, description: "出力音量（0〜1）。" },
    { id: "mute", label: "mute", kind: "enum", default: "off", options: ["off", "on"], description: "ミュート。on で無音（volume を無視）。" },
  ],
  createState(env: NodeEnv): AudioOutputState {
    const ctx = env.audioContext;
    const gain = ctx.createGain();
    // #172: 参照先シーンとして評価される場合は destination へ繋がない（音は SceneInput.audio 経由で親が発音）。
    if (!env.referencedScene) gain.connect(ctx.destination);
    return { ctx, gain, connected: null };
  },
  disposeState(state: NodeState): void {
    const st = state as AudioOutputState;
    try { st.connected?.disconnect(st.gain); } catch { /* already disconnected */ }
    try { st.gain.disconnect(); } catch { /* ignore */ }
  },
  evaluate(ctx) {
    const st = ctx.state as AudioOutputState | undefined;
    if (!st) return {};
    const node = asAudioNode(ctx.input("audio"));
    // 入力が変わったときだけ繋ぎ替える（毎フレーム connect しない）。
    if (node !== st.connected) {
      if (st.connected) { try { st.connected.disconnect(st.gain); } catch { /* ignore */ } }
      if (node) node.connect(st.gain);
      st.connected = node;
    }
    const mute = ctx.param("mute") === "on";
    st.gain.gain.value = mute ? 0 : Number(ctx.param("volume") ?? 1);
    // #172: 参照先シーン文脈では gain をシーンの音声出力としてランタイムへ通知する。
    ctx.env?.captureSceneAudio?.(st.gain);
    return {};
  },
};
