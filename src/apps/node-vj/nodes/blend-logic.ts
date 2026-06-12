// Blend ノードの純粋ロジック（#85）。
export const BLEND_MODES = ["normal", "add", "multiply", "screen"] as const;
export type BlendMode = typeof BLEND_MODES[number];

/** enum param（文字列）→ シェーダの uMode 値。未知は normal(0)。 */
export function blendModeToFloat(mode: unknown): number {
  switch (mode) {
    case "add": return 1;
    case "multiply": return 2;
    case "screen": return 3;
    default: return 0; // normal
  }
}
