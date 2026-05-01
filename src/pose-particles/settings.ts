/**
 * Live-tunable parameters surfaced to the user via the SettingsPanel.
 *
 * Defaults are chosen to feel a bit more reactive than the spec's hard-coded
 * values; everything can be cranked up further from the GUI.
 */
export interface Settings {
  audioGain: {
    /** 0..5, multiplied into AudioFeatures.volume before it hits any shader. */
    volume: number;
    bass: number;
    mid: number;
    treble: number;
  };
  pointCloud: {
    /** Bass-driven radial expansion of each joint cluster. */
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
}

export function makeDefaultSettings(): Settings {
  return {
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
  };
}
