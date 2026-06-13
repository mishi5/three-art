// 2 値 enum を on/off トグルとして扱う純粋ロジック（#66）。
import type { ParamDef } from "../graph/node-type";

/** 2 値 enum（off/on, on/off 等）はクリックで即トグルする UI にする。 */
export function isToggleParam(pd: ParamDef): boolean {
  return pd.kind === "enum" && !!pd.options && pd.options.length === 2;
}

/** トグルの「ON 側」の値。on/true を優先、無ければ 2 つ目を ON 扱い。 */
export function toggleOnValue(pd: ParamDef): string {
  const opts = pd.options ?? [];
  if (opts.includes("on")) return "on";
  if (opts.includes("true")) return "true";
  return opts[1] ?? "";
}

/** 現在値からもう片方の値へ反転する。 */
export function toggledValue(pd: ParamDef, current: unknown): string {
  const opts = pd.options ?? [];
  return String(current) === opts[0] ? (opts[1] ?? opts[0] ?? "") : (opts[0] ?? "");
}
