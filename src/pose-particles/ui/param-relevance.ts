/**
 * パラメータ単位の mode relevance 正本 (Issue #23 改訂)。
 *
 * 各 settings leaf (ドット記法パス、param-docs と同じ規約) が、どの render mode
 * で実際に効果を持つかをレンダリングコード調査に基づき定義する。SettingsPanel は
 * これを使い無関係なパラメータを disable する。純粋関数。
 */
import type { RenderMode } from "../settings";

const ALL: readonly RenderMode[] = ["bones", "cube", "sphere", "lattice", "image", "rain"];
/** 粒子群を描画する mode (rain は粒子群を描かない)。 */
const PARTICLE: readonly RenderMode[] = ["bones", "cube", "sphere", "lattice", "image"];
const HSV_COLOR: readonly RenderMode[] = ["bones", "cube", "sphere", "lattice"];
const EDGE_MODES: readonly RenderMode[] = ["bones", "cube", "sphere"];
const WAVE_SHARED: readonly RenderMode[] = ["lattice", "image"];

/** settings leaf パス → そのパラメータが効く mode 集合。 */
const RELEVANCE: Record<string, ReadonlySet<RenderMode>> = {
  mode: new Set(ALL),
  audioSmoothing: new Set(ALL),

  "audioGain.volume": new Set(PARTICLE),
  "audioGain.bass": new Set(PARTICLE),
  "audioGain.mid": new Set(PARTICLE),
  "audioGain.treble": new Set(PARTICLE),

  "color.hueBase": new Set(HSV_COLOR),
  "color.hueSpread": new Set(HSV_COLOR),
  "color.saturation": new Set(HSV_COLOR),
  "color.bassHueShift": new Set(HSV_COLOR),
  // image はセル RGB を直接使うが trebleBoost の明度ブーストのみ効く。
  "color.trebleBoost": new Set(PARTICLE),

  // bassExpansion は bones の関節クラスタ膨張専用。他は粒子全 mode。
  "pointCloud.bassExpansion": new Set(["bones"]),
  "pointCloud.trebleShimmer": new Set(PARTICLE),
  "pointCloud.ambientShimmer": new Set(PARTICLE),
  "pointCloud.baseSize": new Set(PARTICLE),
  "pointCloud.volumeSize": new Set(PARTICLE),

  // FragmentField は bones モードのみ visible。
  "fragmentField.driftBase": new Set(["bones"]),
  "fragmentField.midDrift": new Set(["bones"]),
  "fragmentField.jointPull": new Set(["bones"]),
  "fragmentField.noiseScale": new Set(["bones"]),
  "fragmentField.timeSpeed": new Set(["bones"]),

  // bones では PointCloud 内未使用だが EdgeOverlay で参照されるため実効。
  "shape.radius": new Set(PARTICLE),
  "shape.bassPulse": new Set(PARTICLE),

  "camera.autoRotateSpeed": new Set(ALL),

  "motion.target": new Set(ALL),
  "motion.strength": new Set(ALL),

  "outlier.fraction": new Set(PARTICLE),
  "outlier.boost": new Set(PARTICLE),

  // EdgeOverlay は lattice/image/rain で visible=false。
  "edges.enabled": new Set(EDGE_MODES),
  "edges.anchorCount": new Set(EDGE_MODES),
  "edges.kNeighbors": new Set(EDGE_MODES),
  "edges.alpha": new Set(EDGE_MODES),

  "edges.wave.enabled": new Set(EDGE_MODES),
  "edges.wave.subdivisions": new Set(EDGE_MODES),
  "edges.wave.amplitude": new Set(EDGE_MODES),
  "edges.wave.audioBoost": new Set(EDGE_MODES),
  "edges.wave.scale": new Set(EDGE_MODES),
  "edges.wave.speed": new Set(EDGE_MODES),

  "edges.rewire.enabled": new Set(EDGE_MODES),
  "edges.rewire.interval": new Set(EDGE_MODES),
  "edges.rewire.fraction": new Set(EDGE_MODES),
  "edges.rewire.fadeDuration": new Set(EDGE_MODES),
  "edges.rewire.candidatePool": new Set(EDGE_MODES),

  "twist.enabled": new Set(PARTICLE),
  "twist.axis": new Set(PARTICLE),
  "twist.strength": new Set(PARTICLE),
  "twist.bassDrive": new Set(PARTICLE),
  "twist.phaseSpeed": new Set(PARTICLE),

  "blur.enabled": new Set(ALL),
  "blur.strength": new Set(ALL),
  "blur.iterations": new Set(ALL),
  "blur.bassDrive": new Set(ALL),

  // wave 系は image の shockwave で流用。resolution/onset は lattice 専用。
  "lattice.resolution": new Set(["lattice"]),
  "lattice.waveSpeed": new Set(WAVE_SHARED),
  "lattice.waveAmplitude": new Set(WAVE_SHARED),
  "lattice.waveOscFreq": new Set(WAVE_SHARED),
  "lattice.waveDamping": new Set(WAVE_SHARED),
  "lattice.onsetThreshold": new Set(["lattice"]),
  "lattice.onsetCooldown": new Set(["lattice"]),
  // 形状歪み (Issue #41): 全て lattice 専用
  "lattice.baseShape": new Set(["lattice"]),
  "lattice.noiseScale": new Set(["lattice"]),
  "lattice.noiseAmount": new Set(["lattice"]),
  "lattice.noiseSeed": new Set(["lattice"]),
  "lattice.twist": new Set(["lattice"]),
  "lattice.bend": new Set(["lattice"]),
  "lattice.taper": new Set(["lattice"]),
  "lattice.rippleFreq": new Set(["lattice"]),
  "lattice.rippleAmp": new Set(["lattice"]),

  "image.preset": new Set(["image"]),
  "image.gridW": new Set(["image"]),
  "image.gridH": new Set(["image"]),
  "image.pushAmount": new Set(["image"]),
  "image.noiseAmp": new Set(["image"]),
  "image.noiseScale": new Set(["image"]),
  "image.noiseSpeed": new Set(["image"]),
  "image.waveStrength": new Set(["image"]),
  "image.sizeScale": new Set(["image"]),
  "image.particleShape": new Set(["image"]),

  "rain.baseSpeed": new Set(["rain"]),
  "rain.ampGain": new Set(["rain"]),
  "rain.count": new Set(["rain"]),
  "rain.length": new Set(["rain"]),
  "rain.areaWidth": new Set(["rain"]),
  "rain.areaHeight": new Set(["rain"]),
  "rain.binMapping": new Set(["rain"]),

  "auto.enabled": new Set(ALL),
  "auto.transitionSec": new Set(ALL),
  "auto.noveltyThreshold": new Set(ALL),
  "auto.minSectionSec": new Set(ALL),
  "auto.styleStrength": new Set(ALL),
};

/** path がその mode で効くか。未登録パスは fail-open (true)。 */
export function paramActiveForMode(path: string, mode: RenderMode): boolean {
  const set = RELEVANCE[path];
  if (!set) return true;
  return set.has(mode);
}

/** relevance マップに登録済みの全パス (完全性テスト用)。 */
export function relevancePaths(): string[] {
  return Object.keys(RELEVANCE);
}
