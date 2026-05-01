/**
 * Live-tunable parameters surfaced to the user via the SettingsPanel.
 *
 * Defaults are chosen to feel a bit more reactive than the spec's hard-coded
 * values; everything can be cranked up further from the GUI.
 */
export type RenderMode = "bones" | "cube" | "sphere";

export const RENDER_MODES: ReadonlyArray<RenderMode> = ["bones", "cube", "sphere"];

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
      radius: 1.0,
      bassPulse: 0.5,
    },
    color: {
      hueBase: 0.6,
      hueSpread: 0.4,
      bassHueShift: 0.0,
      saturation: 0.6,
      trebleBoost: 0.3,
    },
  };
}
