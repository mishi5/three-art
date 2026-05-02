import GUI from "lil-gui";
import type { Settings } from "../settings";
import { RENDER_MODES, MOTION_TARGETS, makeDefaultSettings, saveSettings, clearSettings } from "../settings";

export class SettingsPanel {
  private gui: GUI;
  private settings: Settings;

  constructor(settings: Settings) {
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
    color.add(settings.color, "saturation", 0, 1, 0.01).name("saturation (0=mono)");
    color.add(settings.color, "hueBase", 0, 1, 0.01).name("hue base");
    color.add(settings.color, "hueSpread", 0, 1, 0.01).name("hue spread (rainbow)");
    color.add(settings.color, "bassHueShift", 0, 1, 0.01).name("bass hue shift");
    color.add(settings.color, "trebleBoost", 0, 2, 0.05).name("treble brightness");

    const pc = this.gui.addFolder("PointCloud (体の点群)");
    pc.add(settings.pointCloud, "bassExpansion", 0, 8, 0.1).name("bass expansion");
    pc.add(settings.pointCloud, "trebleShimmer", 0, 0.2, 0.005).name("treble shimmer");
    pc.add(settings.pointCloud, "ambientShimmer", 0, 0.05, 0.001).name("ambient shimmer");
    pc.add(settings.pointCloud, "baseSize", 0, 10, 0.1).name("base size (px)");
    pc.add(settings.pointCloud, "volumeSize", 0, 20, 0.1).name("volume size (px)");

    const shape = this.gui.addFolder("Shape (cube / sphere mode)");
    shape.add(settings.shape, "radius", 0.1, 3, 0.05).name("radius / half-size");
    shape.add(settings.shape, "bassPulse", 0, 3, 0.05).name("bass pulse");

    const ff = this.gui.addFolder("FragmentField (空間の細片)");
    ff.add(settings.fragmentField, "driftBase", 0, 2, 0.05).name("drift base");
    ff.add(settings.fragmentField, "midDrift", 0, 3, 0.05).name("mid drift");
    ff.add(settings.fragmentField, "jointPull", 0, 0.2, 0.005).name("joint pull");
    ff.add(settings.fragmentField, "noiseScale", 0.05, 3, 0.05).name("noise scale");
    ff.add(settings.fragmentField, "timeSpeed", 0, 1, 0.01).name("noise speed");

    const cam = this.gui.addFolder("Camera");
    cam.add(settings.camera, "autoRotateSpeed", -10, 10, 0.1).name("auto rotate (0=off)");

    const outlier = this.gui.addFolder("Outliers (silhouette chaos)");
    outlier.add(settings.outlier, "fraction", 0, 0.5, 0.01).name("fraction (~10%)");
    outlier.add(settings.outlier, "boost", 1, 8, 0.1).name("position/size boost");

    const motion = this.gui.addFolder("Motion influence");
    motion.add(settings.motion, "target", [...MOTION_TARGETS]).name("target param");
    motion.add(settings.motion, "strength", 0, 30, 0.1).name("strength");

    // Preset save / load / reset
    const presets = this.gui.addFolder("Preset");
    const actions = {
      reset: () => this.applyPreset(makeDefaultSettings(), { clearStorage: true }),
      exportJson: () => this.exportJson(),
      importJson: () => this.importJson(),
    };
    presets.add(actions, "reset").name("reset to defaults");
    presets.add(actions, "exportJson").name("export preset (.json)");
    presets.add(actions, "importJson").name("import preset (.json)");

    // Auto-save to localStorage on any change.
    this.gui.onChange(() => saveSettings(settings));

    const dom = this.gui.domElement;
    dom.style.position = "fixed";
    dom.style.top = "180px";
    dom.style.right = "16px";
    dom.style.zIndex = "55";
    dom.style.maxHeight = "calc(100vh - 200px)";
    dom.style.overflowY = "auto";
  }

  /** Replaces the live settings object's contents with another set, then refreshes the GUI. */
  applyPreset(next: Settings, opts: { clearStorage?: boolean } = {}): void {
    deepAssign(this.settings as unknown as Record<string, unknown>, next as unknown as Record<string, unknown>);
    this.gui.controllersRecursive().forEach((c) => c.updateDisplay());
    if (opts.clearStorage) clearSettings();
    else saveSettings(this.settings);
  }

  private exportJson(): void {
    const json = JSON.stringify(this.settings, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    a.download = `pose-particles-preset-${ts}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  private importJson(): void {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) return;
      file.text().then((text) => {
        try {
          const parsed = JSON.parse(text) as Partial<Settings>;
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
