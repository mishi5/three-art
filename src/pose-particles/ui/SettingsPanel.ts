import GUI from "lil-gui";
import type { Settings } from "../settings";
import { RENDER_MODES } from "../settings";

export class SettingsPanel {
  private gui: GUI;

  constructor(settings: Settings) {
    this.gui = new GUI({ title: "Settings", width: 300 });

    // Mode (top-level, no folder so it's hard to miss)
    this.gui.add(settings, "mode", [...RENDER_MODES]).name("render mode");

    const audio = this.gui.addFolder("Audio gain (0..5)");
    audio.add(settings.audioGain, "volume", 0, 5, 0.05);
    audio.add(settings.audioGain, "bass", 0, 5, 0.05);
    audio.add(settings.audioGain, "mid", 0, 5, 0.05);
    audio.add(settings.audioGain, "treble", 0, 5, 0.05);

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

    // Place under the existing top-right control panel.
    const dom = this.gui.domElement;
    dom.style.position = "fixed";
    dom.style.top = "180px";
    dom.style.right = "16px";
    dom.style.zIndex = "55";
    dom.style.maxHeight = "calc(100vh - 200px)";
    dom.style.overflowY = "auto";
  }

  dispose(): void {
    this.gui.destroy();
  }
}
