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

/** Issue #34: タブ化のためのトップレベルフォルダ名 (表示順)。 */
const TAB_NAMES = ["Audio", "Look", "Particles", "Mode", "Post-process", "System"] as const;
type TabName = typeof TAB_NAMES[number];

/**
 * Issue #34: 幅 340px の lil-gui に 6 タブを横並びで収めるための短縮表示。
 * `data-settings-tab` 属性は元のフォルダ名 (TAB_NAMES) を使い、表示テキストは
 * このマップで上書きする。Post-process は full にすると Particles と被って溢れる。
 */
const TAB_LABELS: Record<TabName, string> = {
  Audio: "Audio",
  Look: "Look",
  Particles: "Parts",
  Mode: "Mode",
  "Post-process": "Post",
  System: "Sys",
};

export class SettingsPanel {
  private gui: GUI;
  private settings: Settings;
  private callbacks: SettingsPanelCallbacks;
  /** image の upload ボタン (mode==="image" でのみ活性)。 */
  private imageUploadController: Controller | null = null;
  /** randomize 実行直前の settings スナップショット (undo 用)。 */
  private prevSnapshot: Settings | null = null;
  /** Issue #34: タブ切替対象のトップレベルフォルダ (name → folder)。 */
  private tabFolders: Map<TabName, GUI> = new Map();
  /** Issue #34: タブバー DOM。 */
  private tabBar: HTMLDivElement | null = null;
  /** Issue #34: Quick Actions の undo ボタン状態同期用 callback。 */
  private onUndoStateChange: ((enabled: boolean) => void) | null = null;

  constructor(settings: Settings, onReanalyze: () => void, callbacks: SettingsPanelCallbacks = {}) {
    this.settings = settings;
    this.callbacks = callbacks;
    // Issue #34: タブバー (6 タブ) を収め、内部 slider が横スクロールに
    //   ならない幅。300 では Post-process タブと slider の数値表示が
    //   微妙に溢れていた。
    this.gui = new GUI({ title: "Settings", width: 340 });

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
    this.tabFolders.set("Audio", audio);
    audio.add(settings.audioGain, "volume", 0, 5, 0.05);
    audio.add(settings.audioGain, "bass", 0, 5, 0.05);
    audio.add(settings.audioGain, "mid", 0, 5, 0.05);
    audio.add(settings.audioGain, "treble", 0, 5, 0.05);
    audio.add(settings, "audioSmoothing", 0, 0.95, 0.01).name("smoothing (0=instant)");

    // ---- Look ----
    const look = this.gui.addFolder("Look");
    this.tabFolders.set("Look", look);
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
    this.tabFolders.set("Particles", particles);
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

    const edgeWave = edges.addFolder("Wave (noise displacement)");
    edgeWave.add(settings.edges.wave, "enabled").name("enabled");
    edgeWave.add(settings.edges.wave, "subdivisions", 2, 16, 1).name("subdivisions");
    edgeWave.add(settings.edges.wave, "amplitude", 0, 0.5, 0.005).name("amplitude (m)");
    edgeWave.add(settings.edges.wave, "audioBoost", 0, 3, 0.05).name("bass boost");
    edgeWave.add(settings.edges.wave, "scale", 0.5, 10, 0.1).name("noise scale");
    edgeWave.add(settings.edges.wave, "speed", 0, 3, 0.05).name("noise speed");

    const edgeRewire = edges.addFolder("Rewire (periodic shuffle)");
    edgeRewire.add(settings.edges.rewire, "enabled").name("enabled");
    edgeRewire.add(settings.edges.rewire, "interval", 0, 5, 0.05).name("interval (s)");
    edgeRewire.add(settings.edges.rewire, "fraction", 0, 1, 0.05).name("fraction");
    edgeRewire.add(settings.edges.rewire, "fadeDuration", 0.05, 1, 0.01).name("fade (s)");
    edgeRewire.add(settings.edges.rewire, "candidatePool", 1, 10, 1).name("candidate pool");

    // ---- Mode (モード専用ゾーン: mode 連動 disable の対象) ----
    const modeZone = this.gui.addFolder("Mode");
    this.tabFolders.set("Mode", modeZone);
    const shape = modeZone.addFolder("Shape (cube / sphere)");
    shape.add(settings.shape, "polyhedron", {
      "4 (tetrahedron)": 4,
      "6 (cube)": 6,
      "8 (octahedron)": 8,
      "12 (dodecahedron)": 12,
    }).name("polyhedron faces");
    shape.add(settings.shape, "radius", 0.1, 3, 0.05).name("radius / half-size");
    shape.add(settings.shape, "bassPulse", 0, 3, 0.05).name("bass pulse");

    const wave = modeZone.addFolder("Wave (lattice / image 共有)");
    wave.add(settings.lattice, "waveSpeed", 0.5, 3.0, 0.05).name("wave speed (m/s)");
    wave.add(settings.lattice, "waveOscFreq", 1.0, 10.0, 0.1).name("osc freq (Hz)");
    wave.add(settings.lattice, "waveDamping", 0.1, 1.5, 0.01).name("damping (sec)");
    wave.add(settings.lattice, "onsetThreshold", 0.02, 0.5, 0.005).name("onset threshold");
    wave.add(settings.lattice, "onsetCooldown", 0.05, 0.5, 0.005).name("onset cooldown (sec)");

    const lattice = modeZone.addFolder("Lattice");
    lattice.add(settings.lattice, "baseShape", ["cube", "sphere"]).name("base shape");
    lattice.add(settings.lattice, "resolution", 8, 17, 1).name("resolution NxNxN");
    lattice.add(settings.lattice, "waveAmplitude", 0.0, 0.5, 0.005).name("wave amplitude (m)");

    const distortion = lattice.addFolder("Distortion (shape warp)");
    distortion.add(settings.lattice, "noiseScale", 0.1, 3.0, 0.01).name("noise scale (1/m)");
    distortion.add(settings.lattice, "noiseAmount", 0.0, 0.5, 0.005).name("noise amount (m)");
    distortion.add(settings.lattice, "noiseSeed", 1, 16, 1).name("noise seed");
    distortion.add(settings.lattice, "twist", -Math.PI, Math.PI, 0.01).name("twist (rad/m)");
    distortion.add(settings.lattice, "bend", -Math.PI / 4, Math.PI / 4, 0.005).name("bend (rad/m)");
    distortion.add(settings.lattice, "taper", 0.3, 1.7, 0.01).name("taper");
    distortion.add(settings.lattice, "rippleFreq", 0.5, 6.0, 0.05).name("ripple freq (1/m)");
    distortion.add(settings.lattice, "rippleAmp", 0.0, 0.3, 0.002).name("ripple amp (m)");

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
    this.tabFolders.set("Post-process", post);
    const twist = post.addFolder("Twist (ねじれ)");
    twist.add(settings.twist, "enabled").name("enabled").onChange(() => this.applyActivation());
    twist.add(settings.twist, "axis", [...TWIST_AXES]).name("axis");
    twist.add(settings.twist, "strength", 0, 10, 0.05).name("strength (rad/m)");
    twist.add(settings.twist, "bassDrive", 0, 3, 0.05).name("bass drive");
    twist.add(settings.twist, "phaseSpeed", -3, 3, 0.05).name("phase speed (rad/s)");
    // ---- Post effects (Issue #42) ----
    // 順序入れ替え可能な部品化 post パイプライン。Blur / Kaleidoscope / Fractal
    // の 3 effect が直列接続される。順序は ↑↓ ボタンで編集し、settings.post.order
    // に反映 → 次フレームの PostPipeline.update が syncOrder で composer を再構築する。
    const postFx = post.addFolder("Post effects");

    const orderFolder = postFx.addFolder("Order (top → applied first)");
    const orderUpdaters: Array<() => void> = [];
    const moveEffect = (id: string, direction: -1 | 1): void => {
      const order = settings.post.order;
      const idx = order.indexOf(id);
      if (idx < 0) return;
      const target = idx + direction;
      if (target < 0 || target >= order.length) return;
      const tmp = order[idx]!;
      order[idx] = order[target]!;
      order[target] = tmp;
      saveSettings(settings);
      refreshOrderLabels();
    };
    const refreshOrderLabels = (): void => {
      orderUpdaters.forEach((fn) => fn());
    };
    for (const id of ["blur", "kaleidoscope", "fractal"]) {
      const upCtrl = orderFolder.add({ up: () => moveEffect(id, -1) }, "up");
      const downCtrl = orderFolder.add({ down: () => moveEffect(id, +1) }, "down");
      orderUpdaters.push(() => {
        const i = settings.post.order.indexOf(id);
        const pos = i < 0 ? "?" : String(i + 1);
        upCtrl.name(`↑ ${pos}. ${id}`);
        downCtrl.name(`↓ ${pos}. ${id}`);
      });
    }
    refreshOrderLabels();

    const blur = postFx.addFolder("Blur");
    blur.add(settings.blur, "enabled").name("enabled").onChange(() => this.applyActivation());
    blur.add(settings.blur, "strength", 0, 30, 0.1).name("strength (px)");
    blur.add(settings.blur, "iterations", 1, 6, 1).name("iterations");
    blur.add(settings.blur, "bassDrive", 0, 3, 0.05).name("bass drive");

    const kal = postFx.addFolder("Kaleidoscope");
    kal.add(settings.post.kaleidoscope, "enabled").name("enabled");
    kal.add(settings.post.kaleidoscope, "segments", 2, 16, 1).name("segments");
    kal.add(settings.post.kaleidoscope, "centerX", -0.5, 0.5, 0.01).name("center X");
    kal.add(settings.post.kaleidoscope, "centerY", -0.5, 0.5, 0.01).name("center Y");
    kal.add(settings.post.kaleidoscope, "rotation", -Math.PI, Math.PI, 0.01).name("rotation (rad)");
    kal.add(settings.post.kaleidoscope, "mix", 0, 1, 0.01).name("mix");

    const frac = postFx.addFolder("Fractal (Droste)");
    frac.add(settings.post.fractal, "enabled").name("enabled");
    frac.add(settings.post.fractal, "iterations", 1, 6, 1).name("iterations");
    frac.add(settings.post.fractal, "scale", 0.5, 0.95, 0.01).name("scale");
    frac.add(settings.post.fractal, "centerX", -0.5, 0.5, 0.01).name("center X");
    frac.add(settings.post.fractal, "centerY", -0.5, 0.5, 0.01).name("center Y");
    frac.add(settings.post.fractal, "rotation", -Math.PI, Math.PI, 0.01).name("rotation (rad)");
    frac.add(settings.post.fractal, "fade", 0, 1, 0.01).name("fade");
    frac.add(settings.post.fractal, "mix", 0, 1, 0.01).name("mix");

    // ---- System ----
    const system = this.gui.addFolder("System");
    this.tabFolders.set("System", system);
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

    // Issue #34: 頻用ボタン (randomize / undo / manage / next / random) は
    //   QuickActionsBar に移譲した。lil-gui には低頻度の
    //   reset / export / import のみ残す。
    const presets = system.addFolder("Preset");
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
    // Issue #34: 上部 Quick Actions バー (top:16, 高さ ~48px) と
    //   重ならないよう top を 80px へ下げる。タブバーが更に 32px 占めるので
    //   実質コンテンツは 112px から始まる。
    dom.style.top = "80px";
    dom.style.right = "16px";
    dom.style.zIndex = "55";
    dom.style.maxHeight = "calc(100vh - 100px)";
    dom.style.overflowY = "auto";
    // Issue #34: lil-gui 内部 slider の数値表示やラベルが幅をギリギリ超えると
    //   横スクロールバーが出るため、明示的に抑止する。
    dom.style.overflowX = "hidden";

    // Issue #34: トップレベルフォルダの排他切替タブを lil-gui のタイトル直下へ挿入。
    this.tabBar = this.buildTabBar();
    const title = dom.querySelector(".title");
    if (title && title.parentElement === dom) {
      title.insertAdjacentElement("afterend", this.tabBar);
    } else {
      dom.insertBefore(this.tabBar, dom.firstChild);
    }
    this.switchTab("Audio");

    // パラメータ単位の mode relevance + enabled 連動でコントローラを
    // enable/disable する (唯一の disable 機構)。Issue #23。
    this.applyActivation();

    // 各パラメータにホバー説明ツールチップを付与 (Issue #27)。
    attachParamTooltips(this.gui, settings);
  }

  /**
   * Issue #34: トップレベルフォルダを排他的に切替えるタブバーを構築する。
   * クリック時に active 以外を `close()` して縦スクロールを抑える。
   */
  private buildTabBar(): HTMLDivElement {
    const bar = document.createElement("div");
    bar.setAttribute("data-role", "settings-tabs");
    bar.style.cssText = `
      display: flex; gap: 2px; padding: 4px 6px;
      background: rgba(0,0,0,0.3);
      border-bottom: 1px solid rgba(255,255,255,0.1);
      overflow: hidden;
      box-sizing: border-box; width: 100%;
    `;
    for (const name of TAB_NAMES) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = TAB_LABELS[name];
      btn.title = name; // フルラベルはホバーで確認できる
      btn.setAttribute("data-settings-tab", name);
      btn.style.cssText = `
        flex: 1 1 0;
        min-width: 0;
        min-height: 28px;
        background: transparent;
        color: #ddd;
        border: 1px solid transparent;
        border-radius: 3px;
        cursor: pointer;
        font-size: 11px; font-family: system-ui, sans-serif;
        padding: 4px 2px;
        text-overflow: ellipsis; overflow: hidden; white-space: nowrap;
      `;
      btn.addEventListener("click", () => this.switchTab(name));
      bar.appendChild(btn);
    }
    return bar;
  }

  /**
   * Issue #34: `active` のフォルダのみ open、他は close。タブ button にも
   * `qa-tab-active` クラスを当てて見た目を切り替える。
   */
  private switchTab(active: TabName): void {
    for (const [name, folder] of this.tabFolders) {
      if (name === active) folder.open();
      else folder.close();
    }
    if (this.tabBar) {
      for (const btn of this.tabBar.querySelectorAll<HTMLButtonElement>("button[data-settings-tab]")) {
        const isActive = btn.getAttribute("data-settings-tab") === active;
        btn.classList.toggle("qa-tab-active", isActive);
        btn.style.background = isActive ? "rgba(255,255,255,0.12)" : "transparent";
        btn.style.color = isActive ? "#fff" : "#ddd";
        btn.style.borderColor = isActive ? "rgba(255,255,255,0.25)" : "transparent";
      }
    }
  }

  /** Replaces the live settings object's contents with another set, then refreshes the GUI. */
  applyPreset(next: Settings, opts: { clearStorage?: boolean } = {}): void {
    const before = structuredClone(this.settings) as Settings;
    deepAssign(this.settings as unknown as Record<string, unknown>, next as unknown as Record<string, unknown>);
    this.gui.controllersRecursive().forEach((c) => c.updateDisplay());
    this.applyActivation();
    if (opts.clearStorage) clearSettings();
    else saveSettings(this.settings);
    // Issue #26: プリセット切替時に image preset / grid が変わったら App に通知する。
    // randomize / undoRandomize と同じパスを通す。
    this.applyImageSideEffects(before, this.settings);
  }

  /**
   * 現在の render mode 関連パラメータを一様乱数化し、直前状態を保持する。
   * Issue #34: QuickActionsBar から呼ぶため public 化。
   */
  randomize(): void {
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
    this.applyImageSideEffects(before, this.settings);
    this.onUndoStateChange?.(true);
  }

  /**
   * randomize 直前の状態に戻す。連打しても "直前" (= randomize 直前) に戻る。
   * Issue #34: QuickActionsBar から呼ぶため public 化。
   */
  undoRandomize(): void {
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
    // 履歴は 1 段なので undo 後は再度 disabled へ。
    this.prevSnapshot = null;
    this.onUndoStateChange?.(false);
  }

  /** Issue #34: QuickActionsBar の undo ボタン活性判定に使う。 */
  canUndoRandomize(): boolean {
    return this.prevSnapshot !== null;
  }

  /**
   * Issue #34: undo 可否が変化するたびに通知する callback を登録する。
   * QuickActionsBar.setUndoEnabled と接続する想定。
   */
  setOnUndoStateChange(cb: (enabled: boolean) => void): void {
    this.onUndoStateChange = cb;
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
