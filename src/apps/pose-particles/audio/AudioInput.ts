import type { AudioFeatures } from "../types";

export interface AudioInput {
  /** 音声を開始（user gesture 内で呼ぶ）*/
  start(): Promise<void>;
  /** 停止 + リソース解放 */
  stop(): void;
  /** 現在の音響特徴量を取得（フレームごとに呼ぶ）*/
  read(): AudioFeatures;
}
