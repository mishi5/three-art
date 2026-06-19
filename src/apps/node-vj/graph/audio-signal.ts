// #127/#128: ルーティング可能な実音声信号（audioSignal ポート）の表現。
// `audio` ポートが流す解析結果 AudioFeatures とは別物で、WebAudio の AudioNode を運ぶ。
import type { PortDef } from "./node-type";

/** audioSignal ポートを流れる値。`node` は共有 AudioContext 上の出力 AudioNode。 */
export interface AudioSignal {
  node: AudioNode;
}

/** 音声入力/Mix ノードが出力する signal ポート定義。 */
export const SIGNAL_OUTPUT: PortDef = {
  id: "signal",
  label: "signal",
  type: "audioSignal",
  description: "ルーティング用の実音声信号。Audio Mix / Audio 出力ノードへ繋ぐと発音/合成できる。",
};

/** AudioNode（or null）から signal 出力オブジェクトを組み立てる。null なら未接続（音なし）。 */
export function signalOutput(node: AudioNode | null | undefined): { signal: AudioSignal | undefined } {
  return { signal: node ? { node } : undefined };
}

/** EvalContext.input の戻り値から AudioNode を取り出す（未接続/型不一致は null）。 */
export function asAudioNode(value: unknown): AudioNode | null {
  const sig = value as AudioSignal | undefined;
  return sig && typeof sig === "object" && "node" in sig ? sig.node : null;
}
