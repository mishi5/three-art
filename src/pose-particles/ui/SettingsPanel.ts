import GUI, { Controller } from "lil-gui";
import type { Settings } from "../settings";
import { RENDER_MODES, MOTION_TARGETS, makeDefaultSettings, saveSettings, clearSettings } from "../settings";
import { TWIST_AXES } from "../visuals/twist";
import { parsePresetYaml, serializePresetYaml } from "./preset-yaml";
import { randomizeSettings } from "./randomize";
import { attachParamTooltips } from "./param-tooltip";
import { resolveDocKey } from "./param-docs";
import { paramActiveForMode } from "./param-relevance";

/** enabled チェックボックスで配下を従属させるグループ (Issue #23 改訂)。 */
const GATED_GROUPS = ["twist", "blur", "edges", "auto"] as const;
type GatedGroup = typeof GATED_GROUPS[number];

/** image モードの画像ソース指定 */
export type ImageSource =
  | { kind: "preset"; path: string }
  | { kind: "file"; file: File };

export interface SettingsPanelCallbacks {
  /** プリセット切替 / アップロード時に App へ通知 */
  onImageRequest?: (src: ImageSource) => void;
  /** gridW / gridH 変更時に App へ通知 (現在の画像で再サンプリング) */
  onImageRegridRequest?: () => void;
}

/** 利用可能なプリセット画像 (public/images/presets/ 配下) */
const IMAGE_PRESETS = ["sample-01.svg", "sample-02.svg"] as const;
const UPLOADED_TAG = "(uploaded)";

export class SettingsPanel {
  private gui: GUI;
  private settings: Settings;
  private callbacks: SettingsPanelCallbacks;
  /** image の upload ボタン (mode==="image" でのみ活性)。 */
  private imageUploadController: Controller | null = null;
  /** randomize 実行直前の settings スナップショット (undo 用)。 */
  private prevSnapshot: Settings | null = null;
  private undoController: Controller | null = null;

  constructor(settings: Settings, onReanalyze: () => void, callbacks: SettingsPanelCallbacks = {}) {
    this.settings = settings;
    this.callbacks = callbacks;
    this.gui = new GUI({ title: "Settings", width: 300 });

    // render mode (top-level, no folder so it's hard to miss)
    this.gui
      .add(settings, "mode", [...RENDER_MODES])
      .name("render mode")
      .onChange((v: string) => {
        console.log("[SettingsPanel] mode →", v, "settings.mode =", settings.mode);
        this.applyActivation();
      });

    // ---- Audio ----
    const audio = this.gui.addFolder("Audio");
    audio.add(settings.audioGain, "volume", 0, 5, 0.05);
    audio.add(settings.audioGain, "bass", 0, 5, 0.05);
    audio.add(settings.audioGain, "mid", 0, 5, 0.05);
    audio.add(settings.audioGain, "treble", 0, 5, 0.05);
    audio.add(settings, "audioSmoothing", 0, 0.95, 0.01).name("smoothing (0=instant)");

    // ---- Look ----
    const look = this.gui.addFolder("Look");
    const color = look.addFolder("Color");
    color.add(settings.color, "saturation", 0, 1, 0.01).name("saturation (0=mono)");
    color.add(settings.color, "hueBase", 0, 1, 0.01).name("hue base");
    color.add(settings.color, "hueSpread", 0, 1, 0.01).name("hue spread (rainbow)");
    color.add(settings.color, "bassHueShift", 0, 1, 0.01).name("bass hue shift");
    color.add(settings.color, "trebleBoost", 0, 2, 0.05).name("treble brightness");
    const outlier = look.addFolder("Outliers (spike chaos)");
    outlier.add(settings.outlier, "fraction", 0, 0.5, 0.01).name("fraction (~10%)");
    outlier.add(settings.outlier, "boost", 1, 8, 0.1).name("spike amplitude");

    // ---- Particles ----
    const particles = this.gui.addFolder("Particles");
    const pc = particles.addFolder("PointCloud (体の点群)");
    pc.add(settings.pointCloud, "bassExpansion", 0, 8, 0.1).name("bass expansion");
    pc.add(settings.pointCloud, "trebleShimmer", 0, 0.2, 0.005).name("treble shimmer");
    pc.add(settings.pointCloud, "ambientShimmer", 0, 0.05, 0.001).name("ambient shimmer");
    pc.add(settings.pointCloud, "baseSize", 0, 10, 0.1).name("base size (px)");
    pc.add(settings.pointCloud, "volumeSize", 0, 20, 0.1).name("volume size (px)");
    const ff = particles.addFolder("FragmentField (空間の細片)");
    ff.add(settings.fragmentField, "driftBase", 0, 2, 0.05).name("drift base");
    ff.add(settings.fragmentField, "midDrift", 0, 3, 0.05).name("mid drift");
    ff.add(settings.fragmentField, "jointPull", 0, 0.2, 0.005).name("joint pull");
    ff.add(settings.fragmentField, "noiseScale", 0.05, 3, 0.05).name("noise scale");
    ff.add(settings.fragmentField, "timeSpeed", 0, 1, 0.01).name("noise speed");
    const edges = particles.addFolder("Edges (sub-render)");
    edges.add(settings.edges, "enabled").name("enabled").onChange(() => this.applyActivation());
    edges.add(settings.edges, "anchorCount", 16, 256, 1).name("anchor count");
    edges.add(settings.edges, "kNeighbors", 1, 5, 1).name("k neighbours");
    edges.add(settings.edges, "alpha", 0, 1, 0.01).name("opacity");

    // ---- Mode (モード専用ゾーン: mode 連動 disable の対象) ----
    const modeZone = this.gui.addFolder("Mode");
    const shape = modeZone.addFolder("Shape (cube / sphere)");
    shape.add(settings.shape, "radius", 0.1, 3, 0.05).name("radius / half-size");
    shape.add(settings.shape, "bassPulse", 0, 3, 0.05).name("bass pulse");

    const wave = modeZone.addFolder("Wave (lattice / image 共有)");
    wave.add(settings.lattice, "waveSpeed", 0.5, 3.0, 0.05).name("wave speed (m/s)");
    wave.add(settings.lattice, "waveOscFreq", 1.0, 10.0, 0.1).name("osc freq (Hz)");
    wave.add(settings.lattice, "waveDamping", 0.1, 1.5, 0.01).name("damping (sec)");
    wave.add(settings.lattice, "onsetThreshold", 0.02, 0.5, 0.005).name("onset threshold");
    wave.add(settings.lattice, "onsetCooldown", 0.05, 0.5, 0.005).name("onset cooldown (sec)");

    const lattice = modeZone.addFolder("Lattice");
    lattice.add(settings.lattice, "resolution", 8, 17, 1).name("resolution NxNxN");
    lattice.add(settings.lattice, "waveAmplitude", 0.0, 0.5, 0.005).name("wave amplitude (m)");

    const imageFolder = modeZone.addFolder("Image");
    const presetOptions: Record<string, string> = {};
    for (const p of IMAGE_PRESETS) presetOptions[p] = p;
    presetOptions[UPLOADED_TAG] = UPLOADED_TAG;
    imageFolder.add(settings.image, "preset", presetOptions).name("preset").onChange((v: string) => {
      if (v !== UPLOADED_TAG) callbacks.onImageRequest?.({ kind: "preset", path: v });
    });
    this.imageUploadController = imageFolder.add(
      { upload: () => this.openImageUpload(callbacks.onImageRequest) },
      "upload",
    ).name("upload image…");
    imageFolder.add(settings.image, "gridW", 8, 120, 1).name("grid W").onChange(() => callbacks.onImageRegridRequest?.());
    imageFolder.add(settings.image, "gridH", 8, 120, 1).name("grid H").onChange(() => callbacks.onImageRegridRequest?.());
    imageFolder.add(settings.image, "sizeScale", 0.3, 3.0, 0.05).name("particle size scale");
    imageFolder.add(settings.image, "particleShape", { circle: "circle", square: "square" }).name("particle shape");
    imageFolder.add(settings.image, "pushAmount", 0, 2, 0.05).name("Z push (mid+treble)");
    imageFolder.add(settings.image, "noiseAmp", 0, 0.5, 0.005).name("noise amp (m)");
    imageFolder.add(settings.image, "noiseScale", 0.5, 8, 0.1).name("noise scale");
    imageFolder.add(settings.image, "noiseSpeed", 0, 3, 0.05).name("noise speed");
    imageFolder.add(settings.image, "waveStrength", 0, 0.5, 0.005).name("wave strength (m)");

    const rain = modeZone.addFolder("Rain");
    rain.add(settings.rain, "baseSpeed", 0.0, 0.8, 0.005).name("base speed (m/s)");
    rain.add(settings.rain, "ampGain", 0.0, 4.0, 0.02).name("amp gain (m/s)");
    rain.add(settings.rain, "count", 256, 20000, 1).name("count (re-enter mode)");
    rain.add(settings.rain, "length", 0.0, 0.2, 0.002).name("drop length (m)");
    rain.add(settings.rain, "areaWidth", 0.5, 6.0, 0.05).name("area width (m)");
    rain.add(settings.rain, "areaHeight", 0.5, 6.0, 0.05).name("area height (m)");
    rain.add(settings.rain, "binMapping", ["linear", "log"]).name("bin mapping");

    // ---- Post-process ----
    const post = this.gui.addFolder("Post-process");
    const twist = post.addFolder("Twist (ねじれ)");
    twist.add(settings.twist, "enabled").name("enabled").onChange(() => this.applyActivation());
    twist.add(settings.twist, "axis", [...TWIST_AXES]).name("axis");
    twist.add(settings.twist, "strength", 0, 10, 0.05).name("strength (rad/m)");
    twist.add(settings.twist, "bassDrive", 0, 3, 0.05).name("bass drive");
    twist.add(settings.twist, "phaseSpeed", -3, 3, 0.05).name("phase speed (rad/s)");
    const blur = post.addFolder("Blur (post-process)");
    blur.add(settings.blur, "enabled").name("enabled").onChange(() => this.applyActivation());
    blur.add(settings.blur, "strength", 0, 30, 0.1).name("strength (px)");
    blur.add(settings.blur, "iterations", 1, 6, 1).name("iterations");
    blur.add(settings.blur, "bassDrive", 0, 3, 0.05).name("bass drive");

    // ---- System ----
    const system = this.gui.addFolder("System");
    const cam = system.addFolder("Camera");
    cam.add(settings.camera, "autoRotateSpeed", -10, 10, 0.1).name("auto rotate (0=off)");
    const motion = system.addFolder("Motion influence");
    motion.add(settings.motion, "target", [...MOTION_TARGETS]).name("target param");
    motion.add(settings.motion, "strength", 0, 30, 0.1).name("strength");
    const auto = system.addFolder("Auto Mode");
    auto.add(settings.auto, "enabled").name("enabled").onChange(() => this.applyActivation());
    auto.add(settings.auto, "transitionSec", 0.5, 3.0, 0.05).name("transition (s)");
    auto.add(settings.auto, "noveltyThreshold", 0.0, 1.0, 0.01).name("sensitivity (0..1)");
    auto.add(settings.auto, "minSectionSec", 1.0, 10.0, 0.1).name("min section (s)");
    auto.add(settings.auto, "styleStrength", 0.0, 1.0, 0.01).name("style blend (0..1)");
    auto.add({ reanalyze: () => onReanalyze() }, "reanalyze").name("Re-analyze");

    const presets = system.addFolder("Preset");
    const actions = {
      reset: () => this.applyPreset(makeDefaultSettings(), { clearStorage: true }),
      exportYaml: () => this.exportYaml(),
      importYaml: () => this.importYaml(),
    };
    presets.add(actions, "reset").name("reset to defaults");
    presets.add(actions, "exportYaml").name("export preset (.yaml)");
    presets.add(actions, "importYaml").name("import preset (.yaml)");
    const randomizeActions = {
      randomize: () => this.randomize(),
      undo: () => this.undoRandomize(),
    };
    presets.add(randomizeActions, "randomize").name("randomize (current mode)");
    this.undoController = presets
      .add(randomizeActions, "undo")
      .name("undo randomize")
      .disable();

    // Auto-save to localStorage on any change.
    this.gui.onChange(() => saveSettings(settings));

    const dom = this.gui.domElement;
    dom.style.position = "fixed";
    dom.style.top = "180px";
    dom.style.right = "16px";
    dom.style.zIndex = "55";
    dom.style.maxHeight = "calc(100vh - 200px)";
    dom.style.overflowY = "auto";

    // パラメータ単位の mode relevance + enabled 連動でコントローラを
    // enable/disable する (唯一の disable 機構)。Issue #23。
    this.applyActivation();

    // 各パラメータにホバー説明ツールチップを付与 (Issue #27)。
    attachParamTooltips(this.gui, settings);
  }

  /** Replaces the live settings object's contents with another set, then refreshes the GUI. */
  applyPreset(next: Settings, opts: { clearStorage?: boolean } = {}): void {
    deepAssign(this.settings as unknown as Record<string, unknown>, next as unknown as Record<string, unknown>);
    this.gui.controllersRecursive().forEach((c) => c.updateDisplay());
    this.applyActivation();
    if (opts.clearStorage) clearSettings();
    else saveSettings(this.settings);
  }

  /** 現在の render mode 関連パラメータを一様乱数化し、直前状態を保持する。 */
  private randomize(): void {
    const before = structuredClone(this.settings) as Settings;
    const next = randomizeSettings(this.settings, this.settings.mode);
    this.prevSnapshot = before;
    deepAssign(
      this.settings as unknown as Record<string, unknown>,
      next as unknown as Record<string, unknown>,
    );
    this.gui.controllersRecursive().forEach((c) => c.updateDisplay());
    this.applyActivation();
    saveSettings(this.settings);
    this.undoController?.enable();
    this.applyImageSideEffects(before, this.settings);
  }

  /** randomize 直前の状態に戻す。連打しても "直前" (= randomize 直前) に戻る。 */
  private undoRandomize(): void {
    if (!this.prevSnapshot) return;
    const before = structuredClone(this.settings) as Settings;
    deepAssign(
      this.settings as unknown as Record<string, unknown>,
      this.prevSnapshot as unknown as Record<string, unknown>,
    );
    this.gui.controllersRecursive().forEach((c) => c.updateDisplay());
    this.applyActivation();
    saveSettings(this.settings);
    this.applyImageSideEffects(before, this.settings);
  }

  /**
   * image モードの構造系変更を App に反映する。preset 変更時は loadImage が
   * 現在の gridW/gridH で再サンプリングするため、それだけで grid も追従する。
   * その他 mode (rain 等) は live 更新側が毎フレーム差分検知するため不要。
   */
  private applyImageSideEffects(before: Settings, after: Settings): void {
    if (after.mode !== "image") return;
    if (before.image.preset !== after.image.preset && after.image.preset !== UPLOADED_TAG) {
      this.callbacks.onImageRequest?.({ kind: "preset", path: after.image.preset });
      return;
    }
    if (
      before.image.gridW !== after.image.gridW ||
      before.image.gridH !== after.image.gridH
    ) {
      this.callbacks.onImageRegridRequest?.();
    }
  }

  private exportYaml(): void {
    const text = serializePresetYaml(this.settings);
    const blob = new Blob([text], { type: "application/x-yaml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    a.download = `pose-particles-preset-${ts}.yaml`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  private openImageUpload(onImageRequest: SettingsPanelCallbacks["onImageRequest"]): void {
    if (!onImageRequest) return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/webp";
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) return;
      onImageRequest({ kind: "file", file });
      // dropdown を "(uploaded)" に合わせて表示更新 (実画像は currentImage 側に保持)
      this.settings.image.preset = UPLOADED_TAG;
      this.gui.controllersRecursive().forEach((c) => c.updateDisplay());
      saveSettings(this.settings);
    });
    input.click();
  }

  private importYaml(): void {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".yaml,.yml,application/x-yaml,text/yaml";
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) return;
      file.text().then((text) => {
        try {
          const parsed = parsePresetYaml(text);
          deepAssign(
            this.settings as unknown as Record<string, unknown>,
            parsed as unknown as Record<string, unknown>,
          );
          this.gui.controllersRecursive().forEach((c) => c.updateDisplay());
          this.applyActivation();
          saveSettings(this.settings);
        } catch (e) {
          alert("preset import failed: " + (e instanceof Error ? e.message : String(e)));
        }
      });
    });
    input.click();
  }

  dispose(): void {
    this.gui.destroy();
  }

  setVisible(visible: boolean): void {
    this.gui.show(visible);
  }

  /**
   * 従属グループ (twist/blur/edges/auto) のパラメータが、親 `enabled` により
   * 活性であるべきか。`enabled` チェックボックス自身は常に true (mode
   * relevance 側で判定)。それ以外のパスは従属対象外なので true。Issue #23。
   */
  private gatedActive(path: string): boolean {
    const dot = path.indexOf(".");
    if (dot < 0) return true;
    const group = path.slice(0, dot) as GatedGroup;
    if (!(GATED_GROUPS as readonly string[]).includes(group)) return true;
    if (path.slice(dot + 1) === "enabled") return true;
    return (this.settings[group] as { enabled: boolean }).enabled === true;
  }

  /**
   * 全コントローラを「mode relevance」AND「enabled 連動」で enable/disable
   * する (唯一の disable 機構)。settings パスを持たないアクションボタンは
   * 対象外 (undo の初期 disable 状態を壊さないため)。image の upload ボタン
   * のみ mode==="image" で gate する。フォルダは畳まず開いたまま。Issue #23。
   */
  private applyActivation(): void {
    const mode = this.settings.mode;
    for (const c of this.gui.controllersRecursive()) {
      if (c === this.imageUploadController) continue;
      const path = resolveDocKey(this.settings, c.object as object, c.property as string);
      if (path === null) continue;
      const active = paramActiveForMode(path, mode) && this.gatedActive(path);
      if (active) c.enable();
      else c.disable();
    }
    if (mode === "image") this.imageUploadController?.enable();
    else this.imageUploadController?.disable();
  }
}

/** In-place deep assign: copies `over` into `target`, preserving target identity. */
function deepAssign(target: Record<string, unknown>, over: Record<string, unknown>): void {
  for (const key of Object.keys(over)) {
    const overVal = over[key];
    if (overVal === undefined) continue;
    const tVal = target[key];
    if (
      tVal !== null &&
      typeof tVal === "object" &&
      !Array.isArray(tVal) &&
      overVal !== null &&
      typeof overVal === "object" &&
      !Array.isArray(overVal)
    ) {
      deepAssign(tVal as Record<string, unknown>, overVal as Record<string, unknown>);
    } else {
      target[key] = overVal;
    }
  }
}
