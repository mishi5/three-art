/**
 * Live-tunable parameters surfaced to the user via the SettingsPanel.
 *
 * Defaults are chosen to feel a bit more reactive than the spec's hard-coded
 * values; everything can be cranked up further from the GUI.
 */
import { makeDefaultTwist, type TwistSettings } from "./visuals/twist";
import { makeDefaultBlur, type BlurSettings } from "./visuals/blur";

export type RenderMode = "bones" | "cube" | "sphere" | "lattice" | "image";

export const RENDER_MODES: ReadonlyArray<RenderMode> = ["bones", "cube", "sphere", "lattice", "image"];

/** Parameters that body motion can be routed into as a multiplicative boost. */
export const MOTION_TARGETS = [
  "off",
  "audioGain.volume",
  "audioGain.bass",
  "audioGain.mid",
  "audioGain.treble",
  "color.saturation",
  "color.hueSpread",
  "color.bassHueShift",
  "shape.radius",
  "shape.bassPulse",
  "pointCloud.bassExpansion",
  "pointCloud.trebleShimmer",
  "pointCloud.ambientShimmer",
  "pointCloud.volumeSize",
  "fragmentField.driftBase",
  "fragmentField.midDrift",
  "fragmentField.jointPull",
  "fragmentField.noiseScale",
  "fragmentField.timeSpeed",
  "camera.autoRotateSpeed",
  "twist.strength",
  "blur.strength",
  "lattice.waveAmplitude",
  "lattice.waveOscFreq",
  "image.pushAmount",
  "image.noiseAmp",
  "image.waveStrength",
] as const;
export type MotionTarget = typeof MOTION_TARGETS[number];

/** Numeric mode passed to shaders (must match shader switch). */
export function modeToInt(mode: RenderMode): number {
  switch (mode) {
    case "bones": return 0;
    case "cube": return 1;
    case "sphere": return 2;
    case "lattice": return 3;
    case "image": return 4;
  }
}

/** image モード専用パラメータ (Issue #18)。 */
export interface ImageSettings {
  /** プリセットファイル名 (public/images/presets/ 配下)、"(uploaded)" = アップロード済み画像 */
  preset: string;
  /** グリッド W (8..120)。gridW * gridH <= 5200 (粒子総数) */
  gridW: number;
  /** グリッド H (8..120) */
  gridH: number;
  /** Z 押し出しゲイン (中高域 × 輝度に乗算)。0..2 */
  pushAmount: number;
  /** ノイズ歪み振幅 (m)。0..0.5 */
  noiseAmp: number;
  /** ノイズ空間スケール。0.5..8 */
  noiseScale: number;
  /** ノイズ時間スケール。0..3 */
  noiseSpeed: number;
  /** 中心波動振幅 (m)。0..0.5 */
  waveStrength: number;
}

export interface LatticeSettings {
  /** 格子解像度 NxNxN。8..17 */
  resolution: number;
  /** 波速度 (m/s)。0.5..3.0 */
  waveSpeed: number;
  /** 弾性振動の最大変位 (m)。0..0.5 */
  waveAmplitude: number;
  /** 振動周波数 (Hz)。1..10 */
  waveOscFreq: number;
  /** 減衰時定数 (sec)。0.1..1.5 */
  waveDamping: number;
  /** onset しきい値 (1 フレームの bass 増分)。0.02..0.5 */
  onsetThreshold: number;
  /** onset クールダウン (sec)。0.05..0.5 */
  onsetCooldown: number;
}

export interface AutoSettings {
  /** 自動制御を有効化する。曲ファイル再生時のみ実効。 */
  enabled: boolean;
  /** 境界補間の総幅 (秒)。前後 transitionSec/2 が補間ゾーン。 */
  transitionSec: number;
  /** 境界検出の sensitivity (0..1, percentile-based)。 */
  noveltyThreshold: number;
  /** 連続境界をマージする最小間隔 (秒)。 */
  minSectionSec: number;
  /**
   * スタイルプリセットのブレンド強度 (0..1)。0 = 実セクション特徴量のみ、
   * 1 = STYLE_PRESETS が完全支配。中間で section ごとの「テーマ感」が混ざる。
   */
  styleStrength: number;
}

export interface Settings {
  /** Which arrangement the PointCloud particles take. */
  mode: RenderMode;
  audioGain: {
    /** 0..5, multiplied into AudioFeatures.volume before it hits any shader. */
    volume: number;
    bass: number;
    mid: number;
    treble: number;
  };
  /** 0..0.95, low-pass smoothing applied to audio AFTER gain so flicker
   *  on the eye is dampened. 0=instant follow, 0.9 is heavy smoothing. */
  audioSmoothing: number;
  pointCloud: {
    /** Bass-driven radial expansion of each joint cluster (bones mode only). */
    bassExpansion: number;
    /** Treble-driven per-particle shimmer amplitude (m). */
    trebleShimmer: number;
    /** Always-on shimmer amplitude (m). Adds chaos even with no audio. */
    ambientShimmer: number;
    /** Base point size in pixels (before perspective scale). */
    baseSize: number;
    /** Volume-driven extra point size in pixels. */
    volumeSize: number;
  };
  fragmentField: {
    /** Base curl-noise drift magnitude. */
    driftBase: number;
    /** Mid-driven extra drift. */
    midDrift: number;
    /** Pull strength toward visible joints. */
    jointPull: number;
    /** Curl-noise spatial scale (higher = more chaotic). */
    noiseScale: number;
    /** Curl-noise time evolution speed. */
    timeSpeed: number;
  };
  shape: {
    /** Half-extent of the cube / radius of the sphere (m). */
    radius: number;
    /** Bass-driven radial pulse strength. */
    bassPulse: number;
  };
  color: {
    /** Base hue (0..1, wraps). 0=red, 0.33=green, 0.66=blue. */
    hueBase: number;
    /** Per-particle hue spread (0..1). 0 = monochrome, 1 = full rainbow. */
    hueSpread: number;
    /** Hue shift driven by bass (0..1). Color pulses with the beat. */
    bassHueShift: number;
    /** Saturation 0..1. 0 = white/grey, 1 = pure colour. */
    saturation: number;
    /** Treble-driven brightness boost. */
    trebleBoost: number;
  };
  camera: {
    /** OrbitControls autoRotate speed. 0 = off, positive = clockwise, negative = counter. */
    autoRotateSpeed: number;
  };
  motion: {
    /** Which parameter the body's motion magnitude multiplies. "off" disables. */
    target: MotionTarget;
    /** How strongly motion boosts the chosen parameter. param *= 1 + motion * strength. */
    strength: number;
  };
  outlier: {
    /** Fraction (0..1) of particles tagged as outliers. ~0.1 = 10%. */
    fraction: number;
    /** Multiplier on offset/size/shimmer for outlier particles. 1=off, 3=triple. */
    boost: number;
  };
  edges: {
    /** Draw edges between anchor points (sub-render layer). */
    enabled: boolean;
    /** Number of anchor points (16..256). */
    anchorCount: number;
    /** k-nearest neighbours each anchor connects to. 1..5. */
    kNeighbors: number;
    /** Edge brightness 0..1. */
    alpha: number;
  };
  /** Per-axis rotational twist applied to all particle positions. */
  twist: TwistSettings;
  /** Post-process Gaussian blur applied to the final rendered image. */
  blur: BlurSettings;
  /** lattice モード専用パラメータ (Issue #14)。 */
  lattice: LatticeSettings;
  /** image モード専用パラメータ (Issue #18)。 */
  image: ImageSettings;
  /** 曲解析ベースのパラメータ自動制御 (Issue #5)。 */
  auto: AutoSettings;
}

const STORAGE_KEY = "pose-particles.settings.v1";

/**
 * Read settings from localStorage if present, otherwise return defaults.
 * Missing keys (from older snapshots) are filled in from defaults.
 */
export function loadSettings(): Settings {
  const defaults = makeDefaultSettings();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return migrate(deepMerge(defaults, parsed));
  } catch {
    return defaults;
  }
}

/**
 * 古い保存値を新しい slider 範囲に合わせる。Issue #5 のレビュー後に
 * auto.noveltyThreshold の slider 範囲を 0..1 → 0..0.05、デフォルトを
 * 0.4 → 0.005 に変更したため、範囲外の古い値はデフォルトにリセットする。
 */
function migrate(s: Settings): Settings {
  // noveltyThreshold は当初 absolute threshold (0..0.05) として運用していたが、
  // 実音源のスケール依存性が問題で percentile-based の sensitivity (0..1) に
  // 仕様変更した。0.06 未満の保存値はおそらく旧仕様のものと判定し、新仕様の
  // デフォルト 0.7 にリセットする。
  if (s.auto.noveltyThreshold < 0.06) {
    s.auto.noveltyThreshold = 0.7;
  }
  return s;
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // ignore quota / privacy mode errors
  }
}

export function clearSettings(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

/** Deep-merge `over` into a fresh copy of `base`, preserving base structure. */
function deepMerge<T>(base: T, over: Partial<T>): T {
  if (typeof base !== "object" || base === null) return base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const key of Object.keys(over as object)) {
    const baseVal = (base as Record<string, unknown>)[key];
    const overVal = (over as Record<string, unknown>)[key];
    if (overVal === undefined) continue;
    if (
      baseVal !== null &&
      typeof baseVal === "object" &&
      !Array.isArray(baseVal) &&
      overVal !== null &&
      typeof overVal === "object" &&
      !Array.isArray(overVal)
    ) {
      out[key] = deepMerge(baseVal, overVal as Partial<typeof baseVal>);
    } else {
      out[key] = overVal;
    }
  }
  return out as T;
}

export function makeDefaultSettings(): Settings {
  return {
    mode: "bones",
    audioGain: { volume: 2.0, bass: 2.0, mid: 2.0, treble: 2.0 },
    pointCloud: {
      bassExpansion: 3.0,
      trebleShimmer: 0.05,
      ambientShimmer: 0.005,
      baseSize: 3.0,
      volumeSize: 8.0,
    },
    fragmentField: {
      driftBase: 0.5,
      midDrift: 1.0,
      jointPull: 0.04,
      noiseScale: 0.5,
      timeSpeed: 0.1,
    },
    shape: {
      // ~0.4m fits comfortably in view at camera z=1.0, FOV 50°.
      radius: 0.4,
      bassPulse: 0.5,
    },
    color: {
      hueBase: 0.6,
      hueSpread: 0.4,
      bassHueShift: 0.0,
      saturation: 0.6,
      trebleBoost: 0.3,
    },
    camera: {
      autoRotateSpeed: 0.0,
    },
    motion: {
      target: "off",
      strength: 5.0,
    },
    outlier: {
      fraction: 0.1,
      boost: 3.0,
    },
    edges: {
      enabled: false,
      anchorCount: 64,
      kNeighbors: 2,
      alpha: 0.5,
    },
    twist: makeDefaultTwist(),
    blur: makeDefaultBlur(),
    lattice: {
      resolution: 12,
      waveSpeed: 1.2,
      waveAmplitude: 0.15,
      waveOscFreq: 4.0,
      waveDamping: 0.4,
      onsetThreshold: 0.15,
      onsetCooldown: 0.12,
    },
    image: {
      preset: "sample-01.png",
      // 80 * 60 = 4800 ≤ 5200 (粒子総数)
      gridW: 80,
      gridH: 60,
      pushAmount: 0.5,
      noiseAmp: 0.05,
      noiseScale: 2.0,
      noiseSpeed: 0.5,
      waveStrength: 0.15,
    },
    auto: {
      enabled: false,
      transitionSec: 1.5,
      // sensitivity (0..1) として percentile-based に解釈される。0.7 で
      // smoothed novelty の上位 35% (= 1 - 0.7*0.5) を境界候補とする。
      // 曲の絶対値スケールに依存しないため、曲を変えてもチューニング不要。
      noveltyThreshold: 0.7,
      minSectionSec: 4.0,
      styleStrength: 0.6,
    },
    audioSmoothing: 0.5,
  };
}
