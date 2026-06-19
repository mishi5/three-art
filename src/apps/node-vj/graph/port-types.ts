// ノードグラフのポート型（ADR #59）。
// MVP で実際に配線するのは number / pose / audio と visual 駆動経路。
// vec2/vec3/color/texture/trigger は型を定義しておき、対応ノードが出た時点で有効化する。

export type PortType =
  | "number" | "vec2" | "vec3" | "color"
  | "pose" | "audio" | "texture" | "trigger" | "points"
  // #128: ルーティング可能な実音声信号（WebAudio AudioNode）。解析結果の `audio` とは別物。
  | "audioSignal";

export const PORT_TYPES: ReadonlyArray<PortType> = [
  "number", "vec2", "vec3", "color", "pose", "audio", "texture", "trigger", "points", "audioSignal",
];

/**
 * 出力ポート型 `from` を入力ポート型 `to` に接続できるか。
 * MVP は厳密一致のみ。将来の暗黙変換は許可テーブルでここを拡張する。
 */
export function isCompatible(from: PortType, to: PortType): boolean {
  return from === to;
}
