export interface SectionFeatures {
  /** 0..1, 曲全体での volume の min/max を min-max 正規化した値 */
  energyNorm: number;
  /** 0..1, セクション内 bass 平均 (生値) */
  bassAbs: number;
  midAbs: number;
  trebleAbs: number;
}

export interface AutomationEntry {
  /** "color.hueBase" のようなドット記法パス。Settings の階層と一致 */
  target: string;
  base: number;
  we: number; // weight for energyNorm
  wb: number; // weight for bassAbs
  wm: number; // weight for midAbs
  wt: number; // weight for trebleAbs
  min: number;
  max: number;
}

export type AutomationMap = ReadonlyArray<AutomationEntry>;

export function computeValue(e: AutomationEntry, f: SectionFeatures): number {
  const v = e.base + e.we * f.energyNorm + e.wb * f.bassAbs + e.wm * f.midAbs + e.wt * f.trebleAbs;
  if (v < e.min) return e.min;
  if (v > e.max) return e.max;
  return v;
}

/**
 * spec 表（設計書 §DEFAULT_AUTOMATION_MAP）にそって 10 個のパラメータを定義する。
 * チューニングは手動確認時に行う想定で、ここはあくまでセンセーブルな初期値。
 */
export const DEFAULT_AUTOMATION_MAP: AutomationMap = [
  { target: "color.hueBase",            base: 0.66, we: 0,    wb: -0.66, wm: -0.33, wt: 0,    min: 0,   max: 1   },
  { target: "color.saturation",         base: 0.3,  we: 0.7,  wb: 0,     wm: 0,     wt: 0,    min: 0,   max: 1   },
  { target: "color.bassHueShift",       base: 0.0,  we: 0.0,  wb: 0.5,   wm: 0,     wt: 0,    min: 0,   max: 1   },
  { target: "pointCloud.bassExpansion", base: 1.0,  we: 2.0,  wb: 4.0,   wm: 0,     wt: 0,    min: 0,   max: 8.0 },
  { target: "pointCloud.trebleShimmer", base: 0.02, we: 0.04, wb: 0,     wm: 0,     wt: 0.10, min: 0,   max: 0.20},
  { target: "pointCloud.volumeSize",    base: 4.0,  we: 10.0, wb: 0,     wm: 0,     wt: 0,    min: 2.0, max: 20.0},
  { target: "fragmentField.midDrift",   base: 0.5,  we: 0.3,  wb: 0,     wm: 1.5,   wt: 0,    min: 0,   max: 2.5 },
  { target: "fragmentField.jointPull",  base: 0.02, we: 0.04, wb: 0,     wm: 0.04,  wt: 0,    min: 0,   max: 0.15},
  { target: "blur.strength",            base: 0.3,  we: 0.7,  wb: 0,     wm: 0,     wt: 0,    min: 0,   max: 2.0 },
  { target: "camera.autoRotateSpeed",   base: 0.0,  we: 2.0,  wb: 0,     wm: 0,     wt: 0,    min: 0,   max: 4.0 },
];
