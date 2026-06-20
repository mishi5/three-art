// #134: effect ノード共通の有効/無効トグル + パススルー。
// 無効時は入力 texture（"in"）をそのまま出力 texture へ流す（処理をスキップ）。
// THREE 非依存に保つため black/texture は unknown で扱う（評価ロジック層の方針）。
import type { ParamDef } from "../graph/node-type";

/** effect 共通の有効/無効 param（既定 on）。各 effect ノードの params 先頭に置く。 */
export const EFFECT_ENABLED_PARAM: ParamDef = {
  id: "enabled",
  label: "enabled",
  kind: "enum",
  default: "on",
  options: ["on", "off"],
  description: "エフェクトの有効/無効。off で入力をそのまま出力（パススルー）。",
};

/** enabled param が off でないか（未設定は有効扱い）。 */
export function isEffectEnabled(param: (id: string) => unknown): boolean {
  return param("enabled") !== "off";
}

/** パススルー出力: 入力 "in" の texture をそのまま、未接続なら black を返す。 */
export function bypassOutput(
  input: (id: string) => unknown,
  black: unknown,
): Record<string, unknown> {
  return { texture: input("in") ?? black };
}
