import GUI, { Controller } from "lil-gui";
import type { Settings } from "../settings";
import { RENDER_MODES, MOTION_TARGETS, makeDefaultSettings, saveSettings, clearSettings } from "../settings";
import { TWIST_AXES } from "../visuals/twist";
import { parsePresetYaml, serializePresetYaml } from "./preset-yaml";

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
const IMAGE_PRESETS = ["sample-01.png", "sample-02.png"] as const;
const UPLOADED_TAG = "(uploaded)";

export class SettingsPanel {
  private gui: GUI;
  private settings: Settings;
  private autoControlled: Controller[] = [];

  constructor(settings: Settings, onReanalyze: () => void, callbacks: SettingsPanelCallbacks = {}) {
    this.settings = settings;
    this.gui = new GUI({ title: "Settings", width: 300 });

    // Mode (top-level, no folder so it's hard to miss)
    this.gui
      .add(settings, "mode", [...RENDER_MODES])
      .name("render mode")
      .onChange((v: string) => console.log("[SettingsPanel] mode →", v, "settings.mode =", settings.mode));

    const audio = this.gui.addFolder("Audio gain (0..5)");
    audio.add(settings.audioGain, "volume", 0, 5, 0.05);
    audio.add(settings.audioGain, "bass", 0, 5, 0.05);
    audio.add(settings.audioGain, "mid", 0, 5, 0.05);
    audio.add(settings.audioGain, "treble", 0, 5, 0.05);
    audio.add(settings, "audioSmoothing", 0, 0.95, 0.01).name("smoothing (0=instant)");

    const color = this.gui.addFolder("Color");
    this.autoControlled.push(
      color.add(settings.color, "saturation", 0, 1, 0.01).name("saturation (0=mono)"),
    );
    this.autoControlled.push(
      color.add(settings.color, "hueBase", 0, 1, 0.01).name("hue base"),
    );
    color.add(settings.color, "hueSpread", 0, 1, 0.01).name("hue spread (rainbow)");
    this.autoControlled.push(
      color.add(settings.color, "bassHueShift", 0, 1, 0.01).name("bass hue shift"),
    );
    color.add(settings.color, "trebleBoost", 0, 2, 0.05).name("treble brightness");

    const pc = this.gui.addFolder("PointCloud (体の点群)");
    this.autoControlled.push(
      pc.add(settings.pointCloud, "bassExpansion", 0, 8, 0.1).name("bass expansion"),
    );
    this.autoControlled.push(
      pc.add(settings.pointCloud, "trebleShimmer", 0, 0.2, 0.005).name("treble shimmer"),
    );
    pc.add(settings.pointCloud, "ambientShimmer", 0, 0.05, 0.001).name("ambient shimmer");
    pc.add(settings.pointCloud, "baseSize", 0, 10, 0.1).name("base size (px)");
    this.autoControlled.push(
      pc.add(settings.pointCloud, "volumeSize", 0, 20, 0.1).name("volume size (px)"),
    );

    const shape = this.gui.addFolder("Shape (cube / sphere mode)");
    shape.add(settings.shape, "radius", 0.1, 3, 0.05).name("radius / half-size");
    shape.add(settings.shape, "bassPulse", 0, 3, 0.05).name("bass pulse");

    const lattice = this.gui.addFolder("Lattice (lattice mode)");
    lattice.add(settings.lattice, "resolution", 8, 17, 1).name("resolution NxNxN");
    lattice.add(settings.lattice, "waveSpeed", 0.5, 3.0, 0.05).name("wave speed (m/s)");
    lattice.add(settings.lattice, "waveAmplitude", 0.0, 0.5, 0.005).name("wave amplitude (m)");
    lattice.add(settings.lattice, "waveOscFreq", 1.0, 10.0, 0.1).name("osc freq (Hz)");
    lattice.add(settings.lattice, "waveDamping", 0.1, 1.5, 0.01).name("damping (sec)");
    lattice.add(settings.lattice, "onsetThreshold", 0.02, 0.5, 0.005).name("onset threshold");
    lattice.add(settings.lattice, "onsetCooldown", 0.05, 0.5, 0.005).name("onset cooldown (sec)");
    lattice.close();

    const imageFolder = this.gui.addFolder("Image (image mode)");
    // プリセット dropdown: 表示専用の "(uploaded)" は実際に選ばれた時もそのまま (画像差替えなし)
    const presetOptions: Record<string, string> = {};
    for (const p of IMAGE_PRESETS) presetOptions[p] = p;
    presetOptions[UPLOADED_TAG] = UPLOADED_TAG;
    imageFolder.add(settings.image, "preset", presetOptions).name("preset").onChange((v: string) => {
      if (v !== UPLOADED_TAG) callbacks.onImageRequest?.({ kind: "preset", path: v });
    });
    imageFolder.add(
      { upload: () => this.openImageUpload(callbacks.onImageRequest) },
      "upload",
    ).name("upload image…");
    imageFolder.add(settings.image, "gridW", 8, 120, 1).name("grid W").onChange(() => callbacks.onImageRegridRequest?.());
    imageFolder.add(settings.image, "gridH", 8, 120, 1).name("grid H").onChange(() => callbacks.onImageRegridRequest?.());
    this.autoControlled.push(
      imageFolder.add(settings.image, "pushAmount", 0, 2, 0.05).name("Z push (mid+treble)"),
    );
    this.autoControlled.push(
      imageFolder.add(settings.image, "noiseAmp", 0, 0.5, 0.005).name("noise amp (m)"),
    );
    imageFolder.add(settings.image, "noiseScale", 0.5, 8, 0.1).name("noise scale");
    imageFolder.add(settings.image, "noiseSpeed", 0, 3, 0.05).name("noise speed");
    this.autoControlled.push(
      imageFolder.add(settings.image, "waveStrength", 0, 0.5, 0.005).name("wave strength (m)"),
    );
    imageFolder.close();

    const ff = this.gui.addFolder("FragmentField (空間の細片)");
    ff.add(settings.fragmentField, "driftBase", 0, 2, 0.05).name("drift base");
    this.autoControlled.push(
      ff.add(settings.fragmentField, "midDrift", 0, 3, 0.05).name("mid drift"),
    );
    this.autoControlled.push(
      ff.add(settings.fragmentField, "jointPull", 0, 0.2, 0.005).name("joint pull"),
    );
    ff.add(settings.fragmentField, "noiseScale", 0.05, 3, 0.05).name("noise scale");
    ff.add(settings.fragmentField, "timeSpeed", 0, 1, 0.01).name("noise speed");

    const cam = this.gui.addFolder("Camera");
    this.autoControlled.push(
      cam.add(settings.camera, "autoRotateSpeed", -10, 10, 0.1).name("auto rotate (0=off)"),
    );

    const outlier = this.gui.addFolder("Outliers (spike chaos)");
    outlier.add(settings.outlier, "fraction", 0, 0.5, 0.01).name("fraction (~10%)");
    outlier.add(settings.outlier, "boost", 1, 8, 0.1).name("spike amplitude");

    const edges = this.gui.addFolder("Edges (sub-render)");
    edges.add(settings.edges, "enabled").name("enabled");
    edges.add(settings.edges, "anchorCount", 16, 256, 1).name("anchor count");
    edges.add(settings.edges, "kNeighbors", 1, 5, 1).name("k neighbours");
    edges.add(settings.edges, "alpha", 0, 1, 0.01).name("opacity");

    const twist = this.gui.addFolder("Twist (ねじれ)");
    twist.add(settings.twist, "enabled").name("enabled");
    twist.add(settings.twist, "axis", [...TWIST_AXES]).name("axis");
    twist.add(settings.twist, "strength", 0, 10, 0.05).name("strength (rad/m)");
    twist.add(settings.twist, "bassDrive", 0, 3, 0.05).name("bass drive");
    twist.add(settings.twist, "phaseSpeed", -3, 3, 0.05).name("phase speed (rad/s)");

    const blur = this.gui.addFolder("Blur (post-process)");
    blur.add(settings.blur, "enabled").name("enabled");
    this.autoControlled.push(
      blur.add(settings.blur, "strength", 0, 30, 0.1).name("strength (px)"),
    );
    blur.add(settings.blur, "iterations", 1, 6, 1).name("iterations");
    blur.add(settings.blur, "bassDrive", 0, 3, 0.05).name("bass drive");

    const motion = this.gui.addFolder("Motion influence");
    motion.add(settings.motion, "target", [...MOTION_TARGETS]).name("target param");
    motion.add(settings.motion, "strength", 0, 30, 0.1).name("strength");

    const auto = this.gui.addFolder("Auto Mode");
    auto.add(settings.auto, "enabled").name("enabled").onChange((v: boolean) => {
      this.applyAutoDisabled(v);
    });
    auto.add(settings.auto, "transitionSec", 0.5, 3.0, 0.05).name("transition (s)");
    auto.add(settings.auto, "noveltyThreshold", 0.0, 1.0, 0.01).name("sensitivity (0..1)");
    auto.add(settings.auto, "minSectionSec", 1.0, 10.0, 0.1).name("min section (s)");
    auto.add(settings.auto, "styleStrength", 0.0, 1.0, 0.01).name("style blend (0..1)");
    auto.add({ reanalyze: () => onReanalyze() }, "reanalyze").name("Re-analyze");

    // Preset save / load / reset
    const presets = this.gui.addFolder("Preset");
    const actions = {
      reset: () => this.applyPreset(makeDefaultSettings(), { clearStorage: true }),
      exportYaml: () => this.exportYaml(),
      importYaml: () => this.importYaml(),
    };
    presets.add(actions, "reset").name("reset to defaults");
    presets.add(actions, "exportYaml").name("export preset (.yaml)");
    presets.add(actions, "importYaml").name("import preset (.yaml)");

    // Auto-save to localStorage on any change.
    this.gui.onChange(() => saveSettings(settings));

    const dom = this.gui.domElement;
    dom.style.position = "fixed";
    dom.style.top = "180px";
    dom.style.right = "16px";
    dom.style.zIndex = "55";
    dom.style.maxHeight = "calc(100vh - 200px)";
    dom.style.overflowY = "auto";
    this.applyAutoDisabled(settings.auto.enabled);
  }

  /** Replaces the live settings object's contents with another set, then refreshes the GUI. */
  applyPreset(next: Settings, opts: { clearStorage?: boolean } = {}): void {
    deepAssign(this.settings as unknown as Record<string, unknown>, next as unknown as Record<string, unknown>);
    this.gui.controllersRecursive().forEach((c) => c.updateDisplay());
    if (opts.clearStorage) clearSettings();
    else saveSettings(this.settings);
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

  private applyAutoDisabled(disabled: boolean): void {
    for (const c of this.autoControlled) {
      if (disabled) c.disable(); else c.enable();
    }
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
