// #208: 全 number 出力ポート共通の倍率（スケール）。
// 出力値に倍率を掛けてから下流へ渡す。デフォルト 1（＝従来と同じ挙動）。
// number 型以外（signal/texture/audio 等）には掛けない。NaN/undefined は素通し。
import type { NodeInstance } from "./graph-doc";
import type { NodeTypeDef } from "./node-type";

/** スケール未設定・無効値の既定倍率。 */
export const DEFAULT_OUTPUT_SCALE = 1;

/**
 * ノードの評価結果 Record の「number 型出力ポート」値に倍率を適用した Record を返す。
 * - scales 未指定 / 全ポート 1 のときは入力 outputs をそのまま返す（参照不変＝完全に同じ挙動）。
 * - number 型ポートのみ対象（signal/texture 等は無視）。
 * - 倍率が非数値/非有限/1 のポートは素通し（既定 1）。
 * - 出力値が number でない（NaN/undefined/配列など）ポートは素通し。
 */
export function applyOutputScales(
  outputs: Record<string, unknown>,
  def: NodeTypeDef,
  scales: Record<string, number> | undefined,
): Record<string, unknown> {
  if (!scales) return outputs;
  let result: Record<string, unknown> | undefined;
  for (const port of def.outputs) {
    if (port.type !== "number") continue;
    const s = scales[port.id];
    if (typeof s !== "number" || !Number.isFinite(s) || s === DEFAULT_OUTPUT_SCALE) continue;
    const v = outputs[port.id];
    if (typeof v !== "number" || !Number.isFinite(v)) continue; // NaN/undefined は素通し
    result ??= { ...outputs };
    result[port.id] = v * s;
  }
  return result ?? outputs;
}

/** ノードの指定出力ポートの倍率を取得する（未設定/無効は既定 1）。 */
export function getOutputScale(node: NodeInstance, portId: string): number {
  const s = node.outputScales?.[portId];
  return typeof s === "number" && Number.isFinite(s) ? s : DEFAULT_OUTPUT_SCALE;
}

/**
 * ノードの指定出力ポートの倍率を設定する。
 * 既定 1 / 非有限値はエントリを削除して保存をクリーンに保つ（＝従来挙動に戻す）。
 */
export function setOutputScale(node: NodeInstance, portId: string, scale: number): void {
  const valid = Number.isFinite(scale) && scale !== DEFAULT_OUTPUT_SCALE;
  if (!valid) {
    if (node.outputScales) {
      delete node.outputScales[portId];
      if (Object.keys(node.outputScales).length === 0) delete node.outputScales;
    }
    return;
  }
  (node.outputScales ??= {})[portId] = scale;
}

/** 倍率チップの表示文字列（例: ×2 / ×0.5 / ×1.25）。整数は小数を出さない。 */
export function formatScale(scale: number): string {
  if (!Number.isFinite(scale)) return `×${DEFAULT_OUTPUT_SCALE}`;
  const s = Number.isInteger(scale) ? String(scale) : String(Number(scale.toFixed(3)));
  return `×${s}`;
}
