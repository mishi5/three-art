// 出力ポートのライブ値を短い文字列に整形する（エディタ表示用・純粋関数）。
import type { PortType } from "../graph/port-types";

/** ポート値を表示用文字列にする。値が無い場合は空文字。 */
export function formatPortValue(value: unknown, type: PortType): string {
  if (value === undefined || value === null) return "";
  switch (type) {
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) return "";
      return Number.isInteger(value) ? String(value) : value.toFixed(3);
    }
    case "trigger":
      return value ? "▮" : "▯";
    case "vec2":
    case "vec3":
    case "color":
      return Array.isArray(value)
        ? "[" + value.map((n) => (typeof n === "number" ? n.toFixed(2) : "?")).join(",") + "]"
        : "";
    case "pose":
      return "pose";
    case "audio":
      return "audio";
    case "texture":
      return "tex";
    default:
      return "";
  }
}
