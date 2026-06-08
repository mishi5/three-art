// PointCloudVisual の curated param → フル PointCloudUpdateParams 構築（純粋）。
// 非公開フィールドは makeDefaultSettings 準拠の既定値を使う。
import type { PointCloudUpdateParams } from "../../../core/visuals/params";
import type { RenderMode, PolyhedronFaces } from "../../../core/visuals/render-mode";
import { makeDefaultTwist, type TwistAxis } from "../../../core/visuals/twist";

/** 編集公開する curated パラメータ。 */
export interface PointCloudCurated {
  mode: RenderMode;
  radius: number;
  bassPulse: number;
  polyhedron: PolyhedronFaces;
  hueBase: number;
  hueSpread: number;
  saturation: number;
  bassExpansion: number;
  baseSize: number;
  volumeSize: number;
  twistStrength: number;
  twistAxis: TwistAxis;
  latticeResolution: number;
  latticeWaveAmplitude: number;
  gridW: number;
  gridH: number;
}

export const DEFAULT_CURATED: PointCloudCurated = {
  mode: "bones",
  radius: 0.4, bassPulse: 0.5, polyhedron: 6,
  hueBase: 0.6, hueSpread: 0.4, saturation: 0.6,
  bassExpansion: 3.0, baseSize: 3.0, volumeSize: 8.0,
  twistStrength: 0, twistAxis: "y",
  latticeResolution: 12, latticeWaveAmplitude: 0.15,
  gridW: 80, gridH: 60,
};

/** curated を読み出すヘルパ（欠落は DEFAULT_CURATED）。 */
function pick<K extends keyof PointCloudCurated>(c: Partial<PointCloudCurated>, k: K): PointCloudCurated[K] {
  return (c[k] ?? DEFAULT_CURATED[k]) as PointCloudCurated[K];
}

/** curated（部分指定可）からフルの PointCloudUpdateParams を構築する。 */
export function buildPointCloudParams(c: Partial<PointCloudCurated>): PointCloudUpdateParams {
  const twistStrength = pick(c, "twistStrength");
  return {
    mode: pick(c, "mode"),
    pointCloud: {
      bassExpansion: pick(c, "bassExpansion"),
      trebleShimmer: 0.05,
      ambientShimmer: 0.005,
      baseSize: pick(c, "baseSize"),
      volumeSize: pick(c, "volumeSize"),
    },
    shape: {
      radius: pick(c, "radius"),
      bassPulse: pick(c, "bassPulse"),
      polyhedron: pick(c, "polyhedron"),
    },
    color: {
      hueBase: pick(c, "hueBase"),
      hueSpread: pick(c, "hueSpread"),
      bassHueShift: 0.0,
      saturation: pick(c, "saturation"),
      trebleBoost: 0.3,
    },
    outlier: { fraction: 0.1, boost: 3.0 },
    lattice: {
      resolution: pick(c, "latticeResolution"),
      waveSpeed: 1.2,
      waveAmplitude: pick(c, "latticeWaveAmplitude"),
      waveOscFreq: 4.0,
      waveDamping: 0.4,
      onsetThreshold: 0.15,
      onsetCooldown: 0.12,
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
      gridW: pick(c, "gridW"),
      gridH: pick(c, "gridH"),
      pushAmount: 0.5,
      noiseAmp: 0.05,
      noiseScale: 2.0,
      noiseSpeed: 0.5,
      waveStrength: 0.15,
      sizeScale: 1.0,
      particleShape: "circle",
    },
    twist: {
      ...makeDefaultTwist(),
      enabled: twistStrength > 0,
      axis: pick(c, "twistAxis"),
      strength: twistStrength,
    },
  };
}
