// #135: 音声遅延（DelayNode）。audio 信号を delayMs だけ遅らせて出力する。
// 用途: リアルタイム解析では映像がパイプライン分遅れるため、音を同じだけ遅らせて
// AudioOutput へ流すと A/V が揃う（source.audio → AudioDelay → AudioOutput）。
// 解析（signal/各バンド）はソース側でリアルタイムのまま使い、音だけ遅らせる。
import type { NodeEnv, NodeState, NodeTypeDef } from "../graph/node-type";
import { SIGNAL_OUTPUT, asAudioNode, signalOutput } from "../graph/audio-signal";

/** DelayNode の最大遅延（秒）。param 上限 2000ms に対し十分な余裕を確保。 */
const MAX_DELAY_SEC = 5;

interface AudioDelayState {
  ctx: AudioContext;
  delay: DelayNode;
  /** delay に接続済みの入力 AudioNode（変化時のみ繋ぎ替え）。 */
  connected: AudioNode | null;
}

/** 音声遅延ノード（#135）。audio を delayMs 遅らせて出力（A/V 同期の手動合わせ用）。 */
export const AudioDelayNode: NodeTypeDef = {
  type: "AudioDelay",
  category: "process",
  description: "音声(audio)を delayMs だけ遅らせて出力する。映像の遅れに合わせて音を遅らせ、AudioOutput へ繋ぐと A/V が揃う。",
  isSink: false,
  inputs: [{ id: "audio", label: "audio", type: "audio", description: "遅延させる実音声信号。" }],
  outputs: [SIGNAL_OUTPUT],
  params: [
    { id: "delayMs", label: "delayMs", kind: "number", default: 0, min: 0, max: 2000, step: 1, description: "遅延時間（ミリ秒）。映像の遅れに合わせて耳と目で調整する。" },
  ],
  createState(env: NodeEnv): AudioDelayState {
    const ctx = env.audioContext;
    const delay = ctx.createDelay(MAX_DELAY_SEC);
    return { ctx, delay, connected: null };
  },
  disposeState(state: NodeState): void {
    const st = state as AudioDelayState;
    try { st.connected?.disconnect(st.delay); } catch { /* already disconnected */ }
    try { st.delay.disconnect(); } catch { /* ignore */ }
  },
  evaluate(ctx) {
    const st = ctx.state as AudioDelayState | undefined;
    if (!st) return signalOutput(null);
    const node = asAudioNode(ctx.input("audio"));
    // 入力が変わったときだけ繋ぎ替える（毎フレーム connect しない）。
    if (node !== st.connected) {
      if (st.connected) { try { st.connected.disconnect(st.delay); } catch { /* ignore */ } }
      if (node) node.connect(st.delay);
      st.connected = node;
    }
    const sec = Math.max(0, Math.min(MAX_DELAY_SEC, Number(ctx.param("delayMs") ?? 0) / 1000));
    st.delay.delayTime.value = sec;
    return signalOutput(st.delay);
  },
};
