/**
 * "現在の render mode に関連する演出パラメータ" をワンクリックで一様乱数化する
 * ための、パラメータ記述子と純粋なランダム化関数 (Issue #21)。
 *
 * 値域 (min/max/step) は `SettingsPanel` の lil-gui `.add()` 呼び出しと一致させる
 * こと。単一情報源化 (GUI を記述子駆動に) は今回見送ったため、範囲を変更する
 * 場合は両方を手で合わせる責務がある。drift は randomize.test.ts が
 * 「全 path が Settings に実在する」ことまで保証する。
 *
 * `auto.*` は演出ではなく制御系のため対象外。`mode` 自体も対象外。
 */
import { MOTION_TARGETS, type RenderMode, type Settings } from "../settings";
import { TWIST_AXES } from "../visuals/twist";
import { setByPath } from "../automation/setByPath";

export type RandSpec =
  | { path: string; kind: "number"; min: number; max: number; step: number }
  | { path: string; kind: "boolean" }
  | { path: string; kind: "enum"; options: ReadonlyArray<string> }
  | { path: string; kind: "numEnum"; options: ReadonlyArray<number> };

export interface ParamDescriptor {
  spec: RandSpec;
  /** このパラメータを対象にする RenderMode 群。 */
  modes: ReadonlyArray<RenderMode>;
}

// --- mode グループ -------------------------------------------------------
// param-relevance.ts と歩調を合わせること (各 leaf が「実際に効く mode」=
// relevance のキー集合に対応)。
const ALL: ReadonlyArray<RenderMode> = ["bones", "cube", "sphere", "lattice", "image", "rain"];
/** PointCloud で点を描く mode (image=独自グリッド, rain=線分なので除外)。 */
const POINT: ReadonlyArray<RenderMode> = ["bones", "cube", "sphere", "lattice"];
const BONES: ReadonlyArray<RenderMode> = ["bones"];
const CUBE: ReadonlyArray<RenderMode> = ["cube"];
/** shape.* が効く mode (Issue #37): relevance の PARTICLE と一致 (image は色を画像 RGB から取るため除外、rain は粒子群を描かないため除外)。 */
const SHAPE_MODES: ReadonlyArray<RenderMode> = ["bones", "cube", "sphere", "lattice"];
/** EdgeOverlay が描画される mode (Issue #37): relevance の EDGE_MODES と一致。 */
const EDGE: ReadonlyArray<RenderMode> = ["bones", "cube", "sphere"];
const LATTICE: ReadonlyArray<RenderMode> = ["lattice"];
/** 中心波動を共有する lattice + image。 */
const LATTICE_IMAGE: ReadonlyArray<RenderMode> = ["lattice", "image"];
const IMAGE: ReadonlyArray<RenderMode> = ["image"];
const RAIN: ReadonlyArray<RenderMode> = ["rain"];

function num(
  path: string,
  min: number,
  max: number,
  step: number,
  modes: ReadonlyArray<RenderMode>,
): ParamDescriptor {
  return { spec: { path, kind: "number", min, max, step }, modes };
}
function bool(path: string, modes: ReadonlyArray<RenderMode>): ParamDescriptor {
  return { spec: { path, kind: "boolean" }, modes };
}
function enm(
  path: string,
  options: ReadonlyArray<string>,
  modes: ReadonlyArray<RenderMode>,
): ParamDescriptor {
  return { spec: { path, kind: "enum", options }, modes };
}
function numEnm(
  path: string,
  options: ReadonlyArray<number>,
  modes: ReadonlyArray<RenderMode>,
): ParamDescriptor {
  return { spec: { path, kind: "numEnum", options }, modes };
}

export const RANDOMIZE_DESCRIPTORS: ReadonlyArray<ParamDescriptor> = [
  // --- common (全 mode) ---
  num("color.hueBase", 0, 1, 0.01, ALL),
  num("color.hueSpread", 0, 1, 0.01, ALL),
  num("color.bassHueShift", 0, 1, 0.01, ALL),
  num("color.saturation", 0, 1, 0.01, ALL),
  num("color.trebleBoost", 0, 2, 0.05, ALL),
  num("fragmentField.driftBase", 0, 2, 0.05, ALL),
  num("fragmentField.midDrift", 0, 3, 0.05, ALL),
  num("fragmentField.jointPull", 0, 0.2, 0.005, ALL),
  num("fragmentField.noiseScale", 0.05, 3, 0.05, ALL),
  num("fragmentField.timeSpeed", 0, 1, 0.01, ALL),
  bool("twist.enabled", ALL),
  enm("twist.axis", [...TWIST_AXES], ALL),
  num("twist.strength", 0, 10, 0.05, ALL),
  num("twist.bassDrive", 0, 3, 0.05, ALL),
  num("twist.phaseSpeed", -3, 3, 0.05, ALL),
  bool("blur.enabled", ALL),
  num("blur.strength", 0, 30, 0.1, ALL),
  num("blur.iterations", 1, 6, 1, ALL),
  num("blur.bassDrive", 0, 3, 0.05, ALL),
  num("outlier.fraction", 0, 0.5, 0.01, ALL),
  num("outlier.boost", 1, 8, 0.1, ALL),
  num("camera.autoRotateSpeed", -10, 10, 0.1, ALL),
  num("audioGain.volume", 0, 5, 0.05, ALL),
  num("audioGain.bass", 0, 5, 0.05, ALL),
  num("audioGain.mid", 0, 5, 0.05, ALL),
  num("audioGain.treble", 0, 5, 0.05, ALL),
  num("audioSmoothing", 0, 0.95, 0.01, ALL),
  enm("motion.target", [...MOTION_TARGETS], ALL),
  num("motion.strength", 0, 30, 0.1, ALL),

  // --- pointCloud (点を描く mode) ---
  num("pointCloud.trebleShimmer", 0, 0.2, 0.005, POINT),
  num("pointCloud.ambientShimmer", 0, 0.05, 0.001, POINT),
  num("pointCloud.baseSize", 0, 10, 0.1, POINT),
  num("pointCloud.volumeSize", 0, 20, 0.1, POINT),

  // --- bones 専用 (関節クラスタ) ---
  num("pointCloud.bassExpansion", 0, 8, 0.1, BONES),

  // --- EdgeOverlay (bones/cube/sphere; Issue #37 で cube/sphere まで拡張) ---
  bool("edges.enabled", EDGE),
  num("edges.anchorCount", 16, 256, 1, EDGE),
  num("edges.kNeighbors", 1, 5, 1, EDGE),
  num("edges.alpha", 0, 1, 0.01, EDGE),
  // edges 波打ち / リワイヤ (Issue #31)。値域は SettingsPanel と一致させる。
  bool("edges.wave.enabled", EDGE),
  num("edges.wave.subdivisions", 2, 16, 1, EDGE),
  num("edges.wave.amplitude", 0, 0.5, 0.005, EDGE),
  num("edges.wave.audioBoost", 0, 3, 0.05, EDGE),
  num("edges.wave.scale", 0.5, 10, 0.1, EDGE),
  num("edges.wave.speed", 0, 3, 0.05, EDGE),
  bool("edges.rewire.enabled", EDGE),
  num("edges.rewire.interval", 0, 5, 0.05, EDGE),
  num("edges.rewire.fraction", 0, 1, 0.05, EDGE),
  num("edges.rewire.fadeDuration", 0.05, 1, 0.01, EDGE),
  num("edges.rewire.candidatePool", 1, 10, 1, EDGE),

  // --- shape.* (bones/cube/sphere/lattice; Issue #37 で bones/lattice まで拡張) ---
  num("shape.radius", 0.1, 3, 0.05, SHAPE_MODES),
  num("shape.bassPulse", 0, 3, 0.05, SHAPE_MODES),
  // --- shape.polyhedron (cube 専用; Issue #40) ---
  numEnm("shape.polyhedron", [4, 6, 8, 12], CUBE),

  // --- lattice 専用 ---
  num("lattice.resolution", 8, 17, 1, LATTICE),
  num("lattice.waveAmplitude", 0.0, 0.5, 0.005, LATTICE),

  // --- lattice + image 共有 (波動) ---
  num("lattice.waveSpeed", 0.5, 3.0, 0.05, LATTICE_IMAGE),
  num("lattice.waveOscFreq", 1.0, 10.0, 0.1, LATTICE_IMAGE),
  num("lattice.waveDamping", 0.1, 1.5, 0.01, LATTICE_IMAGE),
  num("lattice.onsetThreshold", 0.02, 0.5, 0.005, LATTICE_IMAGE),
  num("lattice.onsetCooldown", 0.05, 0.5, 0.005, LATTICE_IMAGE),

  // --- image 専用 ---
  // image.preset (Issue #37): プリセットファイルが見つからない環境でロード
  // エラーになるため、ランダム化対象から除外。プリセット切替はユーザが GUI
  // から明示的に行う。
  num("image.gridW", 8, 120, 1, IMAGE),
  num("image.gridH", 8, 120, 1, IMAGE),
  num("image.pushAmount", 0, 2, 0.05, IMAGE),
  num("image.noiseAmp", 0, 0.5, 0.005, IMAGE),
  num("image.noiseScale", 0.5, 8, 0.1, IMAGE),
  num("image.noiseSpeed", 0, 3, 0.05, IMAGE),
  num("image.waveStrength", 0, 0.5, 0.005, IMAGE),
  num("image.sizeScale", 0.3, 3.0, 0.05, IMAGE),
  enm("image.particleShape", ["circle", "square"], IMAGE),

  // --- rain 専用 ---
  num("rain.baseSpeed", 0.0, 0.8, 0.005, RAIN),
  num("rain.ampGain", 0.0, 4.0, 0.02, RAIN),
  num("rain.count", 256, 20000, 1, RAIN),
  num("rain.length", 0.0, 0.2, 0.002, RAIN),
  num("rain.areaWidth", 0.5, 6.0, 0.05, RAIN),
  num("rain.areaHeight", 0.5, 6.0, 0.05, RAIN),
  enm("rain.binMapping", ["linear", "log"], RAIN),
];

/** `mode` で乱数化対象になる記述子のみを返す。 */
export function descriptorsForMode(mode: RenderMode): ParamDescriptor[] {
  return RANDOMIZE_DESCRIPTORS.filter((d) => d.modes.includes(mode));
}

/** image モードの粒子総数上限 (粒子バッファ長と一致させること)。 */
const IMAGE_PARTICLE_BUDGET = 5200;

function steppedNumber(spec: Extract<RandSpec, { kind: "number" }>, rng: () => number): number {
  const raw = spec.min + rng() * (spec.max - spec.min);
  const n = Math.round((raw - spec.min) / spec.step);
  const v = spec.min + n * spec.step;
  return Math.min(spec.max, Math.max(spec.min, v));
}

/** gridW * gridH <= budget を満たすよう両軸を等比縮小して整数クランプ。 */
function clampImageBudget(image: Settings["image"]): void {
  if (image.gridW * image.gridH <= IMAGE_PARTICLE_BUDGET) return;
  const f = Math.sqrt(IMAGE_PARTICLE_BUDGET / (image.gridW * image.gridH));
  image.gridW = Math.max(8, Math.floor(image.gridW * f));
  image.gridH = Math.max(8, Math.floor(image.gridH * f));
}

/**
 * `base` を破壊せず、`mode` に関連する記述子だけを一様乱数化した新しい
 * `Settings` を返す。`mode` 自体は変更しない。
 */
export function randomizeSettings(
  base: Settings,
  mode: RenderMode,
  rng: () => number = Math.random,
): Settings {
  const out: Settings = structuredClone(base);
  const target = out as unknown as Record<string, unknown>;
  for (const { spec } of descriptorsForMode(mode)) {
    let value: unknown;
    if (spec.kind === "number") {
      value = steppedNumber(spec, rng);
    } else if (spec.kind === "boolean") {
      value = rng() < 0.5;
    } else if (spec.kind === "numEnum") {
      const idx = Math.min(spec.options.length - 1, Math.floor(rng() * spec.options.length));
      value = spec.options[idx];
    } else {
      // enum (string)
      const idx = Math.min(spec.options.length - 1, Math.floor(rng() * spec.options.length));
      value = spec.options[idx];
    }
    setByPath(target, spec.path, value);
  }
  if (mode === "image") clampImageBudget(out.image);
  return out;
}
