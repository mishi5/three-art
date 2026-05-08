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
/**
 * スタイルプリセット: section index に応じて循環適用される。
 * - features: 連続パラメータ用に SectionFeatures をブレンド (styleStrength で強度)
 * - overrides: discrete な値 (mode / *.enabled など) の上書き。section に入った
 *   瞬間に切替され、補間されない (連続変化できないので意図的に離散切替)
 */
export interface StylePreset {
  features: SectionFeatures;
  overrides: Record<string, unknown>;
}

export const STYLE_PRESETS: ReadonlyArray<StylePreset> = [
  // 0: bones bass-heavy (edges のグラフがメイン)
  {
    features: { energyNorm: 0.2, bassAbs: 0.9, midAbs: 0.1, trebleAbs: 0.0 },
    overrides: {
      mode: "bones",
      "twist.enabled": false,
      "blur.enabled": false,
      "edges.enabled": true,
      "edges.alpha": 0.7,
      "color.hueSpread": 0.1,
    },
  },
  // 1: cube + twist y軸 (中音メイン)
  {
    features: { energyNorm: 0.45, bassAbs: 0.2, midAbs: 0.8, trebleAbs: 0.2 },
    overrides: {
      mode: "cube",
      "twist.enabled": true,
      "twist.axis": "y",
      "twist.strength": 3.0,
      "twist.phaseSpeed": 0.5,
      "blur.enabled": true,
      "edges.enabled": false,
      "color.hueSpread": 0.4,
    },
  },
  // 2: sphere + 全部最大 (ピーク)
  {
    features: { energyNorm: 1.0, bassAbs: 0.7, midAbs: 0.7, trebleAbs: 0.7 },
    overrides: {
      mode: "sphere",
      "twist.enabled": true,
      "twist.axis": "z",
      "twist.strength": 5.0,
      "twist.phaseSpeed": 1.5,
      "blur.enabled": true,
      "edges.enabled": true,
      "edges.alpha": 0.5,
      "outlier.fraction": 0.25,
      "outlier.boost": 5.0,
      "color.hueSpread": 0.7,
    },
  },
  // 3: bones treble-shimmer (高音メイン、ねじれ無し、blur 無し)
  {
    features: { energyNorm: 0.6, bassAbs: 0.0, midAbs: 0.1, trebleAbs: 0.95 },
    overrides: {
      mode: "bones",
      "twist.enabled": false,
      "blur.enabled": false,
      "edges.enabled": false,
      "outlier.fraction": 0.15,
      "outlier.boost": 4.0,
      "color.hueSpread": 0.9,
    },
  },
  // 4: cube + twist x軸 (warm peak、回転速い)
  {
    features: { energyNorm: 0.85, bassAbs: 0.8, midAbs: 0.6, trebleAbs: 0.0 },
    overrides: {
      mode: "cube",
      "twist.enabled": true,
      "twist.axis": "x",
      "twist.strength": 2.0,
      "twist.phaseSpeed": -1.0,
      "blur.enabled": false,
      "edges.enabled": true,
      "edges.alpha": 0.3,
      "color.hueSpread": 0.2,
    },
  },
  // 5: sphere minimal (静寂、ほぼ何も無い)
  {
    features: { energyNorm: 0.05, bassAbs: 0.0, midAbs: 0.0, trebleAbs: 0.0 },
    overrides: {
      mode: "sphere",
      "twist.enabled": false,
      "blur.enabled": true,
      "edges.enabled": false,
      "outlier.fraction": 0.02,
      "color.hueSpread": 0.0,
    },
  },
];

export const DEFAULT_AUTOMATION_MAP: AutomationMap = [
  // base はセクション特徴量がすべて 0 のときの値 (静かなセクション)。
  // we/wb/wm/wt は energyNorm/bassAbs/midAbs/trebleAbs に対する重み。
  // セクション間の視覚差を強く出すため、重みと range を大胆に取る。
  { target: "color.hueBase",            base: 0.66, we: 0,    wb: -1.0,  wm: -0.33, wt: 0,    min: 0,   max: 1    },
  { target: "color.saturation",         base: 0.2,  we: 1.0,  wb: 0,     wm: 0,     wt: 0,    min: 0,   max: 1    },
  { target: "color.bassHueShift",       base: 0.0,  we: 0.0,  wb: 1.0,   wm: 0,     wt: 0,    min: 0,   max: 1    },
  { target: "pointCloud.bassExpansion", base: 0.5,  we: 4.0,  wb: 6.0,   wm: 0,     wt: 0,    min: 0,   max: 12.0 },
  { target: "pointCloud.trebleShimmer", base: 0.01, we: 0.05, wb: 0,     wm: 0,     wt: 0.18, min: 0,   max: 0.25 },
  { target: "pointCloud.volumeSize",    base: 2.0,  we: 16.0, wb: 0,     wm: 0,     wt: 0,    min: 1.0, max: 24.0 },
  { target: "fragmentField.midDrift",   base: 0.2,  we: 0.5,  wb: 0,     wm: 2.5,   wt: 0,    min: 0,   max: 3.5  },
  { target: "fragmentField.jointPull",  base: 0.01, we: 0.06, wb: 0,     wm: 0.10,  wt: 0,    min: 0,   max: 0.20 },
  { target: "blur.strength",            base: 0.0,  we: 2.0,  wb: 0,     wm: 0,     wt: 0,    min: 0,   max: 4.0  },
  { target: "camera.autoRotateSpeed",   base: 0.0,  we: 5.0,  wb: 0,     wm: 0,     wt: 0,    min: 0,   max: 8.0  },
];
