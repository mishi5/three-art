// Blend ノードの純粋ロジック（#85）。
// #280: overlay/difference/subtract/darken/lighten を追加。既存 4 種の uMode 値は変えない
// （YAML 保存済みグラフの mode 文字列・数値対応をそのまま維持する）。
export const BLEND_MODES = [
  "normal", "add", "multiply", "screen", "overlay", "difference", "subtract", "darken", "lighten",
] as const;
export type BlendMode = typeof BLEND_MODES[number];

/** enum param（文字列）→ シェーダの uMode 値（BLEND_MODES の定義順）。未知は normal(0)。 */
export function blendModeToFloat(mode: unknown): number {
  const idx = (BLEND_MODES as readonly unknown[]).indexOf(mode);
  return idx >= 0 ? idx : 0; // 未知は normal
}
