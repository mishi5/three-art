// 入力ポートの分類（#74）。数値 param を入力ポートとして扱うための純粋ヘルパ。
// - signal 入力: param を持たない純信号（pose/audio/texture や Sine の t など）
// - param 入力: 数値 param（kind number/int）。接続時は手動値を上書きする
import type { NodeTypeDef, ParamDef, PortDef } from "./node-type";

export function isNumericParam(p: ParamDef): boolean {
  return p.kind === "number" || p.kind === "int";
}

/** 数値 param に対応する入力ポート（id=param id, type=number）。 */
export function paramInputs(def: NodeTypeDef): PortDef[] {
  return def.params
    .filter(isNumericParam)
    .map((p) => ({ id: p.id, label: p.label, type: "number" as const }));
}

/** 宣言済み入力のうち、同 id の param を持たない純信号入力。 */
export function signalInputs(def: NodeTypeDef): PortDef[] {
  const paramIds = new Set(def.params.map((p) => p.id));
  return def.inputs.filter((port) => !paramIds.has(port.id));
}

/** 接続検証・評価で用いる実効入力ポート（signal ∪ param）。 */
export function effectiveInputPorts(def: NodeTypeDef): PortDef[] {
  return [...signalInputs(def), ...paramInputs(def)];
}

/** その入力ポート id が数値 param 由来か（= 接続時に手動値を上書きする対象か）。 */
export function isParamInput(def: NodeTypeDef, portId: string): boolean {
  return def.params.some((p) => p.id === portId && isNumericParam(p));
}
