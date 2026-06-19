import type { AudioFeatures } from "../types";

export interface AudioInput {
  /** 音声を開始（user gesture 内で呼ぶ）*/
  start(): Promise<void>;
  /** 停止 + リソース解放 */
  stop(): void;
  /** 現在の音響特徴量を取得（フレームごとに呼ぶ）*/
  read(): AudioFeatures;
  /**
   * #128: ルーティング用の出力 AudioNode（`src→analyzer→outputGain` の outputGain）。
   * node-vj の audioSignal ポートで Mix/Output ノードへ繋ぐために使う。
   * `connectToDestination` が false の場合、この node を辿らないと音は出ない。
   */
  readonly output: AudioNode;
}
