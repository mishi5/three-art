/**
 * Live-tunable parameters surfaced to the user via the SettingsPanel.
 *
 * Defaults are chosen to feel a bit more reactive than the spec's hard-coded
 * values; everything can be cranked up further from the GUI.
 */
export type RenderMode = "bones" | "cube" | "sphere";

export const RENDER_MODES: ReadonlyArray<RenderMode> = ["bones", "cube", "sphere"];

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
] as const;
export type MotionTarget = typeof MOTION_TARGETS[number];

/** Numeric mode passed to shaders (must match shader switch). */
export function modeToInt(mode: RenderMode): number {
  return mode === "bones" ? 0 : mode === "cube" ? 1 : 2;
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
    return deepMerge(defaults, parsed);
  } catch {
    return defaults;
  }
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
  };
}
