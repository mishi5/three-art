// 共有 visual モジュールの入力パラメータ型。
//
// 設計方針(ADR #57): core は pose-particles 固有のモノリシックな `Settings` を
// import せず、各モジュールが必要とするフィールドだけを宣言した狭い param 型を持つ。
// pose-particles 側の `Settings` はこれらと構造的に互換なので、App は `live`
// (Settings) をそのまま渡せる（Settings ⊇ Params の構造的部分型）。Settings 側で
// 必要フィールドが失われた場合は App 境界の型検査(bun build)で検出される。

import type { RenderMode, PolyhedronFaces } from "./render-mode";
import type { TwistSettings } from "./twist";

export interface ColorParams {
  /** Base hue (0..1, wraps). */
  hueBase: number;
  /** Per-particle hue spread (0..1). */
  hueSpread: number;
  /** Hue shift driven by bass (0..1). */
  bassHueShift: number;
  /** Saturation 0..1. */
  saturation: number;
  /** Treble-driven brightness boost. */
  trebleBoost: number;
}

export interface ShapeParams {
  /** 外接球半径 (m)。 */
  radius: number;
  /** Bass-driven radial pulse strength. */
  bassPulse: number;
  /** cube モード時の正多面体面数。 */
  polyhedron: PolyhedronFaces;
}

export interface PointCloudVisualParams {
  bassExpansion: number;
  trebleShimmer: number;
  ambientShimmer: number;
  baseSize: number;
  volumeSize: number;
}

export interface FragmentFieldVisualParams {
  driftBase: number;
  midDrift: number;
  jointPull: number;
  noiseScale: number;
  timeSpeed: number;
}

export interface OutlierParams {
  fraction: number;
  boost: number;
}

export interface ImageParams {
  preset: string;
  gridW: number;
  gridH: number;
  pushAmount: number;
  noiseAmp: number;
  noiseScale: number;
  noiseSpeed: number;
  waveStrength: number;
  sizeScale: number;
  particleShape: "circle" | "square";
}

export type LatticeBaseShape = "cube" | "sphere";

export interface LatticeParams {
  resolution: number;
  waveSpeed: number;
  waveAmplitude: number;
  waveOscFreq: number;
  waveDamping: number;
  onsetThreshold: number;
  onsetCooldown: number;
  baseShape: LatticeBaseShape;
  noiseScale: number;
  noiseAmount: number;
  noiseSeed: number;
  twist: number;
  bend: number;
  taper: number;
  rippleFreq: number;
  rippleAmp: number;
}

export interface EdgesWaveParams {
  enabled: boolean;
  subdivisions: number;
  amplitude: number;
  audioBoost: number;
  scale: number;
  speed: number;
}

export interface EdgesRewireParams {
  enabled: boolean;
  interval: number;
  fraction: number;
  fadeDuration: number;
  candidatePool: number;
}

export interface EdgesParams {
  enabled: boolean;
  anchorCount: number;
  kNeighbors: number;
  alpha: number;
  wave: EdgesWaveParams;
  rewire: EdgesRewireParams;
}

export type RainBinMapping = "linear" | "log";

export interface RainParams {
  baseSpeed: number;
  ampGain: number;
  count: number;
  length: number;
  areaWidth: number;
  areaHeight: number;
  binMapping: RainBinMapping;
}

// --- 各 visual モジュールの update() が受け取る合成パラメータ ---

export interface PointCloudUpdateParams {
  mode: RenderMode;
  pointCloud: PointCloudVisualParams;
  shape: ShapeParams;
  color: ColorParams;
  outlier: OutlierParams;
  lattice: LatticeParams;
  image: ImageParams;
  twist: TwistSettings;
}

export interface FragmentFieldUpdateParams {
  fragmentField: FragmentFieldVisualParams;
  color: ColorParams;
  twist: TwistSettings;
}

export interface EdgeOverlayUpdateParams {
  mode: RenderMode;
  edges: EdgesParams;
  outlier: OutlierParams;
  pointCloud: PointCloudVisualParams;
  shape: ShapeParams;
  twist: TwistSettings;
}

export interface RainFieldUpdateParams {
  mode: RenderMode;
  rain: RainParams;
}
