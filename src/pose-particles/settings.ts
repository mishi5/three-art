/**
 * Live-tunable parameters surfaced to the user via the SettingsPanel.
 *
 * Defaults are chosen to feel a bit more reactive than the spec's hard-coded
 * values; everything can be cranked up further from the GUI.
 */
import { makeDefaultTwist, type TwistSettings } from "./visuals/twist";
import { makeDefaultBlur, type BlurSettings } from "./visuals/blur";

export type RenderMode = "bones" | "cube" | "sphere" | "lattice" | "image" | "rain";

export const RENDER_MODES: ReadonlyArray<RenderMode> = ["bones", "cube", "sphere", "lattice", "image", "rain"];

export type PolyhedronFaces = 4 | 6 | 8 | 12;
export const POLYHEDRON_FACES: ReadonlyArray<PolyhedronFaces> = [4, 6, 8, 12];

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
  "lattice.noiseAmount",
  "lattice.twist",
  "lattice.bend",
  "lattice.rippleAmp",
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
    case "rain": return 5;
  }
}

/** image モード専用パラメータ (Issue #18)。 */
export interface ImageSettings {
  /** プリセット識別子 (ui/image-presets.ts の IMAGE_PRESETS)、"(uploaded)" = アップロード済み画像 */
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
  /** 粒子サイズ倍率。セル間隔追従サイズに乗算。0.3..3.0 */
  sizeScale: number;
  /** 粒子の形。"circle"=円 (デフォルト)、"square"=矩形 (完全なドット絵的) */
  particleShape: "circle" | "square";
}

export type LatticeBaseShape = "cube" | "sphere";

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
  // --- 形状歪み (Issue #41) ---
  /** ベース形状。"cube" は現状互換 (NxNxN 立方格子)、"sphere" は cube-to-sphere マッピング。 */
  baseShape: LatticeBaseShape;
  /** ノイズ warp の空間周波数 (1/m)。0.1..3.0。 */
  noiseScale: number;
  /** ノイズ warp の振幅 (m)。0..0.5。0 で歪みなし。 */
  noiseAmount: number;
  /** ノイズ warp のシード (1..16 整数)。形を変えるキー。 */
  noiseSeed: number;
  /** y 軸まわりのねじり (rad/m)。-π..+π。0 で歪みなし。 */
  twist: number;
  /** y 軸まわりの曲げ (rad/m)。-π/4..+π/4。0 で歪みなし。 */
  bend: number;
  /** 上下スケール差。0.3..1.7。1.0 で歪みなし。 */
  taper: number;
  /** ripple の空間周波数 (1/m)。0.5..6.0。 */
  rippleFreq: number;
  /** ripple の振幅 (m)。0..0.3。0 で歪みなし。 */
  rippleAmp: number;
}

export interface KaleidoscopeSettings {
  enabled: boolean;
  /** 扇形セグメント数 (2..16, 整数)。 */
  segments: number;
  /** 中心 X (-0.5..0.5、画面中央=0)。 */
  centerX: number;
  /** 中心 Y (-0.5..0.5)。 */
  centerY: number;
  /** 全体回転 (rad)。 */
  rotation: number;
  /** 元映像とのブレンド率 (0..1)、1=完全に万華鏡。 */
  mix: number;
}

export interface FractalSettings {
  enabled: boolean;
  /** 再帰回数 (1..6、整数)。 */
  iterations: number;
  /** 各反復の縮小率 (0.5..0.95)。 */
  scale: number;
  centerX: number;
  centerY: number;
  /** 反復ごとの回転 (rad)。 */
  rotation: number;
  /** 深いコピーほど暗くするフェード (0..1)。 */
  fade: number;
  /** 元映像とのブレンド率 (0..1)。 */
  mix: number;
}

export interface PostSettings {
  /**
   * post effect の適用順。effect ID の配列。SettingsPanel の ↑↓ ボタンで
   * 入れ替え可能。先頭ほど先に適用される。
   */
  order: string[];
  kaleidoscope: KaleidoscopeSettings;
  fractal: FractalSettings;
}

export type RainBinMapping = "linear" | "log";

export interface RainSettings {
  /** 落下基本速度 (m/s)。鳴っていない帯域でも最低限この速度で落ちる。 */
  baseSpeed: number;
  /** 振幅 1 あたりの追加速度 (m/s)。fft[xIndex] * ampGain が追加される。 */
  ampGain: number;
  /** 雨粒数。再起動 (mode 再選択) で反映される静的パラメータ。 */
  count: number;
  /** 雫の基準長 (m)。実描画長は速度に比例する。 */
  length: number;
  /** 描画域横幅 (m)。FFT bin 全体がこの幅にマップされる。 */
  areaWidth: number;
  /** 描画域高さ (m)。Y はこの高さでリングバッファ。 */
  areaHeight: number;
  /** 周波数 → X のマップ方式 (MVP は linear のみ実装、log は将来)。 */
  binMapping: RainBinMapping;
}

/** Edges 波打ち (Issue #31)。 */
export interface EdgesWaveSettings {
  /** 波打ち on/off。 */
  enabled: boolean;
  /** 1 エッジを何分割するか。2..16。 */
  subdivisions: number;
  /** 振幅基準 (world m)。0..0.5。 */
  amplitude: number;
  /** bass による振幅倍率の係数。amp_eff = amplitude * (1 + bass * audioBoost)。0..3。 */
  audioBoost: number;
  /** ノイズ空間周波数。0.5..10。 */
  scale: number;
  /** ノイズ流速 (時間方向)。0..3。 */
  speed: number;
}

/** Edges リワイヤ (Issue #31)。 */
export interface EdgesRewireSettings {
  /** リワイヤ on/off。 */
  enabled: boolean;
  /** 切替周期 (秒)。0.2..5.0。0 で実質オフ扱い。 */
  interval: number;
  /** 各周期で差し替えるエッジ割合。0..1。 */
  fraction: number;
  /** クロスフェード時間 (秒)。0.05..1.0。 */
  fadeDuration: number;
  /** 候補プール幅 (最近傍 M 個から k 本選ぶ)。kNeighbors..2*kNeighbors 程度。 */
  candidatePool: number;
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
    /** 外接球半径 (中心 → 頂点距離) (m)。Issue #40 で cube モードも sphere と同じ「頂点距離」semantics に統一。 */
    radius: number;
    /** Bass-driven radial pulse strength. */
    bassPulse: number;
    /** cube モード時の正多面体面数 (4=tetra / 6=cube / 8=octa / 12=dodeca)。default 6。Issue #40。 */
    polyhedron: PolyhedronFaces;
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
    /** Per-edge wavy displacement driven by 3D value noise + bass (Issue #31). */
    wave: EdgesWaveSettings;
    /** Periodic rewiring of edges with cross-fade (Issue #31). */
    rewire: EdgesRewireSettings;
  };
  /** Per-axis rotational twist applied to all particle positions. */
  twist: TwistSettings;
  /** Post-process Gaussian blur applied to the final rendered image. */
  blur: BlurSettings;
  /** 部品化された post effects (Issue #42)。順序付き直列適用。 */
  post: PostSettings;
  /** lattice モード専用パラメータ (Issue #14)。 */
  lattice: LatticeSettings;
  /** image モード専用パラメータ (Issue #18)。 */
  image: ImageSettings;
  /** rain モード専用パラメータ (Issue #17)。 */
  rain: RainSettings;
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

/**
 * Deep-merge `over` into a fresh copy of `base`, preserving base structure.
 * Issue #51: applyPreset 経路でも利用するため export 化。
 */
export function deepMerge<T>(base: T, over: Partial<T>): T {
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
      polyhedron: 6,
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
      wave: {
        enabled: false,
        subdivisions: 8,
        amplitude: 0.05,
        audioBoost: 1.0,
        scale: 2.0,
        speed: 0.6,
      },
      rewire: {
        enabled: false,
        interval: 1.5,
        fraction: 0.3,
        fadeDuration: 0.4,
        candidatePool: 4,
      },
    },
    twist: makeDefaultTwist(),
    blur: makeDefaultBlur(),
    post: {
      order: ["blur", "kaleidoscope", "fractal"],
      kaleidoscope: {
        enabled: false,
        segments: 6,
        centerX: 0,
        centerY: 0,
        rotation: 0,
        mix: 1,
      },
      fractal: {
        enabled: false,
        iterations: 3,
        scale: 0.7,
        centerX: 0,
        centerY: 0,
        rotation: 0,
        fade: 0.3,
        mix: 1,
      },
    },
    lattice: {
      resolution: 12,
      waveSpeed: 1.2,
      waveAmplitude: 0.15,
      waveOscFreq: 4.0,
      waveDamping: 0.4,
      onsetThreshold: 0.15,
      onsetCooldown: 0.12,
      // 形状歪み (Issue #41) — デフォルトは「歪みなし」で従来挙動と完全互換
      baseShape: "cube",
      noiseScale: 1.0,
      noiseAmount: 0.0,
      noiseSeed: 1,
      twist: 0.0,
      bend: 0.0,
      taper: 1.0,
      rippleFreq: 2.0,
      rippleAmp: 0.0,
    },
    image: {
      preset: "sample-01.svg",
      // 80 * 60 = 4800 ≤ 5200 (粒子総数)
      gridW: 80,
      gridH: 60,
      pushAmount: 0.5,
      noiseAmp: 0.05,
      noiseScale: 2.0,
      noiseSpeed: 0.5,
      waveStrength: 0.15,
      sizeScale: 1.0,
      particleShape: "circle",
    },
    rain: {
      // 粒子ごとに生成時の振幅で速度を確定し落下中は維持する。
      // 既定はゆっくりめ。スライダ範囲も控えめにして微調整しやすくしている。
      baseSpeed: 0.12,
      ampGain: 1.0,
      count: 4000,
      length: 0.05,
      areaWidth: 2.0,
      areaHeight: 2.4,
      // log: 音楽エネルギーの集中する低域を画面の大半に割り当てる。
      // linear だと無音の高域が画面の 8 割を占めてしまう。
      binMapping: "log",
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
