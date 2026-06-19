// #127/#128: ルーティング可能な実音声信号（ポート型 `audio`・ポート名 "audio"）の表現。
// 解析結果 AudioFeatures（ポート型/名 `signal`）とは別物で、WebAudio の AudioNode を運ぶ。
// 注: コード内の識別子は歴史的に "signal" を含むが、ユーザに見えるポート名は "audio"。
import type { PortDef } from "./node-type";

/** `audio` ポートを流れる値。`node` は共有 AudioContext 上の出力 AudioNode。 */
export interface AudioSignal {
  node: AudioNode;
}

/** 音声入力/Mix ノードが出力する実音声信号ポート（"audio"）の定義。 */
export const SIGNAL_OUTPUT: PortDef = {
  id: "audio",
  label: "audio",
  type: "audio",
  description: "ルーティング用の実音声信号。Audio Mix / Audio 出力ノードへ繋ぐと発音/合成できる。",
};

/** AudioNode（or null）から実音声信号の出力オブジェクト（キー "audio"）を組み立てる。null は未接続。 */
export function signalOutput(node: AudioNode | null | undefined): { audio: AudioSignal | undefined } {
  return { audio: node ? { node } : undefined };
}

/** EvalContext.input の戻り値から AudioNode を取り出す（未接続/型不一致は null）。 */
export function asAudioNode(value: unknown): AudioNode | null {
  const sig = value as AudioSignal | undefined;
  return sig && typeof sig === "object" && "node" in sig ? sig.node : null;
}
