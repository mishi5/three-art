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
 * スタイルプリセット: section index に応じて循環適用される SectionFeatures。
 * 似た特徴量のセクション同士でも見た目が変わるよう、明示的に異なる
 * パターンを 6 個用意し `styleStrength` で実セクション特徴量とブレンドする。
 */
export const STYLE_PRESETS: ReadonlyArray<SectionFeatures> = [
  { energyNorm: 0.2,  bassAbs: 0.9,  midAbs: 0.1, trebleAbs: 0.0  }, // 0: deep & warm (bass-heavy)
  { energyNorm: 0.45, bassAbs: 0.2,  midAbs: 0.8, trebleAbs: 0.2  }, // 1: vocal mid (calm)
  { energyNorm: 1.0,  bassAbs: 0.7,  midAbs: 0.7, trebleAbs: 0.7  }, // 2: peak (bright)
  { energyNorm: 0.6,  bassAbs: 0.0,  midAbs: 0.1, trebleAbs: 0.95 }, // 3: shimmer cold (treble)
  { energyNorm: 0.85, bassAbs: 0.8,  midAbs: 0.6, trebleAbs: 0.0  }, // 4: warm peak
  { energyNorm: 0.05, bassAbs: 0.0,  midAbs: 0.0, trebleAbs: 0.0  }, // 5: minimal (silent feel)
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
