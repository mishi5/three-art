import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { AudioInput } from "./audio/AudioInput";
import { JointAnchors } from "./pose/JointAnchors";
import { PoseInput } from "./pose/PoseInput";
import { DEFAULT_AUDIO_FEATURES, type AudioFeatures } from "./types";
import { PointCloud } from "./visuals/PointCloud";
import { FragmentField } from "./visuals/FragmentField";
import { SkeletonGuide } from "./visuals/SkeletonGuide";
import { EdgeOverlay } from "./visuals/EdgeOverlay";
import { BlurPipeline } from "./visuals/BlurPipeline";
import { DebugOverlay } from "./ui/DebugOverlay";
import { SettingsPanel } from "./ui/SettingsPanel";
import { loadSettings, type Settings, type RenderMode, type MotionTarget } from "./settings";
import { fileHash } from "./automation/fileHash";
import { AnalysisCache, type CachePayload, type BandTimeSeries, type SectionBoundary } from "./automation/AnalysisCache";
import * as SongAnalyzer from "./audio/SongAnalyzer";
import { detect, recomputeSections } from "./audio/SectionDetector";
import { ParameterAutomation } from "./automation/ParameterAutomation";
import { DEFAULT_AUTOMATION_MAP, DEFAULT_STYLE_PRESETS, type StylePreset } from "./automation/AutomationMap";
import { loadStylePresets } from "./automation/style-loader";
import { SectionTimeline } from "./ui/SectionTimeline";
import { FileAudioSource } from "./audio/FileAudioSource";

export class App {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly jointAnchors = new JointAnchors();
  readonly pointCloud: PointCloud;
  readonly fragmentField: FragmentField;
  readonly skeletonGuide: SkeletonGuide;
  readonly edgeOverlay: EdgeOverlay;
  readonly blurPipeline: BlurPipeline;
  readonly originMarker: THREE.Mesh;
  readonly centroidMarker: THREE.Mesh;
  private diagHud: HTMLDivElement;
  private debugVisible = false;
  private uiVisible = true;
  private smoothedAudio = { volume: 0, bass: 0, mid: 0, treble: 0 };
  readonly settings: Settings = loadSettings();
  private settingsPanel: SettingsPanel;
  private orbit: OrbitControls;
  private lastMode: RenderMode | null = null;
  private poseInput: PoseInput | null = null;
  private debugOverlay: DebugOverlay | null = null;
  private audioInput: AudioInput | null = null;
  private audioCtx: AudioContext | null = null;
  private rafId: number | null = null;
  private parameterAutomation: ParameterAutomation | null = null;
  private sectionTimeline: SectionTimeline;
  private currentSongHash: string | null = null;
  private currentSeries: BandTimeSeries | null = null;
  private analyzingToast: HTMLDivElement | null = null;
  /** YAML から読み込まれた style プリセット (失敗時は fallback)。 */
  private loadedStyles: ReadonlyArray<StylePreset> = DEFAULT_STYLE_PRESETS;
  private stylesReady: Promise<void>;

  constructor(canvas: HTMLCanvasElement) {
    this.scene.background = new THREE.Color(0x000000);
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.01, 100);
    // 体（centering 後の visible 関節が原点まわり ±0.25m くらい）が画面の
    // 過半を占めるよう、カメラを近づける（2.5m → 1.0m）。
    this.camera.position.set(0, 0, 1.0);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.blurPipeline = new BlurPipeline(this.renderer, this.scene, this.camera);
    this.handleResize();
    this.pointCloud = new PointCloud(this.renderer.getPixelRatio());
    this.scene.add(this.pointCloud.object3D);
    this.fragmentField = new FragmentField(this.renderer.getPixelRatio());
    this.scene.add(this.fragmentField.object3D);
    this.skeletonGuide = new SkeletonGuide();
    this.scene.add(this.skeletonGuide.object3D);
    this.edgeOverlay = new EdgeOverlay();
    this.scene.add(this.edgeOverlay.object3D);

    // diagnostic markers (toggled with B together with the skeleton).
    // BIG so they cannot be hidden by the particle haze.
    this.originMarker = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.3, 0.3),
      new THREE.MeshBasicMaterial({ color: 0xff0000, depthTest: false, wireframe: true }),
    );
    this.originMarker.renderOrder = 1000;
    this.originMarker.visible = false;
    this.scene.add(this.originMarker);

    this.centroidMarker = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.3, 0.3),
      new THREE.MeshBasicMaterial({ color: 0xffff00, depthTest: false, wireframe: true }),
    );
    this.centroidMarker.renderOrder = 1000;
    this.centroidMarker.visible = false;
    this.scene.add(this.centroidMarker);

    // On-screen HUD that prints what we're feeding the markers each frame,
    // so we can see the actual values without diving into the console.
    this.diagHud = document.createElement("div");
    this.diagHud.style.cssText = `
      position: fixed; left: 16px; top: 16px;
      padding: 6px 10px;
      background: rgba(0,0,0,0.6); color: #fff;
      font: 11px/1.4 monospace; white-space: pre;
      z-index: 70;
      display: none;
      border: 1px solid rgba(255,255,255,0.2);
    `;
    document.body.appendChild(this.diagHud);

    this.sectionTimeline = new SectionTimeline((next) => this.onBoundariesEdited(next));
    this.stylesReady = loadStylePresets().then((styles) => {
      this.loadedStyles = styles;
    });
    this.settingsPanel = new SettingsPanel(this.settings, () => this.reanalyze());

    // Mouse + keyboard camera control. Defaults: left-drag = rotate,
    // right-drag = pan, wheel = zoom. Damping for smoothness.
    this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.08;
    this.orbit.target.set(0, 0, 0);
    this.orbit.minDistance = 0.3;
    this.orbit.maxDistance = 30;
    // Standard arrow-key panning is handled by OrbitControls already
    // (listens on window when enabled).
    this.orbit.listenToKeyEvents(window);

    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("resize", this.handleResize);
  }

  private handleResize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    // updateStyle = true (default) so the canvas CSS size matches the viewport.
    // Passing false here was a bug: with pixelRatio=2 the drawing buffer became
    // 2× larger but CSS was unset, so the canvas was displayed at 2× CSS size
    // and only its upper-left quadrant fit in the viewport — pushing the world
    // origin to the visible bottom-right corner.
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.blurPipeline.setSize(w, h);
  };

  async startPose(): Promise<void> {
    this.poseInput = new PoseInput((result) => {
      this.jointAnchors.update(result);
      this.debugOverlay?.setResult(result);
    });
    await this.poseInput.start();
    this.debugOverlay = new DebugOverlay(this.poseInput.getVideo());
  }

  /** デバッグオーバーレイの表示モードを循環（off → video → skeleton → both）。
   *  キーボードの D キーでも切り替わる。*/
  cycleDebug(): void {
    this.debugOverlay?.cycleMode();
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    // Don't hijack keys when the user is typing into the GUI inputs.
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
    if (e.key === "b" || e.key === "B") {
      this.debugVisible = !this.debugVisible;
      this.originMarker.visible = this.debugVisible;
      this.centroidMarker.visible = this.debugVisible;
      this.diagHud.style.display = this.debugVisible ? "block" : "none";
      // Skeleton only meaningful in bones mode; reflect both flags.
      this.skeletonGuide.object3D.visible = this.debugVisible && this.settings.mode === "bones";
      console.log(`[App] 3D debug overlays: ${this.debugVisible ? "ON" : "OFF"}`);
    }
    if (e.key === "h" || e.key === "H") {
      this.uiVisible = !this.uiVisible;
      this.applyUiVisibility();
      console.log(`[App] UI: ${this.uiVisible ? "ON" : "OFF"}`);
    }
  };

  /** SettingsPanel / SectionTimeline / ファイル選択パネルをまとめて表示・非表示する。 */
  private applyUiVisibility(): void {
    this.settingsPanel.setVisible(this.uiVisible);
    if (this.uiVisible && this.settings.auto.enabled) this.sectionTimeline.show();
    else this.sectionTimeline.hide();
    const uiRoot = document.getElementById("ui-root");
    if (uiRoot) uiRoot.style.display = this.uiVisible ? "" : "none";
  }

  getOrCreateAudioContext(): AudioContext {
    if (!this.audioCtx) this.audioCtx = new AudioContext();
    return this.audioCtx;
  }

  setAudio(audio: AudioInput | null): void {
    this.audioInput?.stop();
    this.audioInput = audio;
  }

  async onSongLoaded(file: File): Promise<void> {
    if (!(this.audioInput instanceof FileAudioSource)) return;
    const buffer = this.audioInput.getDecodedBuffer();
    if (!buffer) return;
    const head = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
    const hash = fileHash(file.name, file.size, head);
    this.currentSongHash = hash;
    await this.runAnalysis(hash, buffer, /*forceReanalyze*/ false);
  }

  async reanalyze(): Promise<void> {
    if (!(this.audioInput instanceof FileAudioSource)) return;
    const buffer = this.audioInput.getDecodedBuffer();
    if (!buffer || !this.currentSongHash) return;
    await this.runAnalysis(this.currentSongHash, buffer, true);
  }

  private async runAnalysis(hash: string, buffer: AudioBuffer, force: boolean): Promise<void> {
    // YAML スタイルロード完了を待つ (通常は曲ロードまでに完了している)
    await this.stylesReady;
    let payload: CachePayload | null = force ? null : AnalysisCache.get(hash);
    if (!payload) {
      this.showAnalyzingToast();
      try {
        const series = await SongAnalyzer.run(buffer);
        // 解析中に別の曲がロードされていたら結果を破棄 (race guard)
        if (this.currentSongHash !== hash) {
          this.hideAnalyzingToast();
          return;
        }
        const det = detect(series, this.settings.auto);
        payload = {
          version: 1,
          series,
          boundaries: det.boundaries,
          sections: det.sections,
        };
        AnalysisCache.set(hash, payload);
      } catch (e) {
        console.warn("[App] song analysis failed", e);
        this.hideAnalyzingToast();
        return;
      }
      this.hideAnalyzingToast();
    }
    // キャッシュヒット時も別曲ロード後なら無視 (race guard)
    if (this.currentSongHash !== hash) return;
    this.currentSeries = payload.series;
    this.sectionTimeline.setData(payload.series, payload.boundaries);
    this.parameterAutomation = new ParameterAutomation(
      payload.sections,
      payload.boundaries,
      DEFAULT_AUTOMATION_MAP,
      this.settings.auto.transitionSec,
      this.loadedStyles,
      this.settings.auto.styleStrength,
    );
  }

  private onBoundariesEdited(next: SectionBoundary[]): void {
    if (!this.currentSeries || !this.currentSongHash) return;
    const sections = recomputeSections(this.currentSeries, next);
    this.parameterAutomation = new ParameterAutomation(
      sections, next, DEFAULT_AUTOMATION_MAP, this.settings.auto.transitionSec,
      this.loadedStyles, this.settings.auto.styleStrength,
    );
    AnalysisCache.set(this.currentSongHash, {
      version: 1,
      series: this.currentSeries,
      boundaries: next,
      sections,
    });
  }

  private showAnalyzingToast(): void {
    if (this.analyzingToast) return;
    const div = document.createElement("div");
    div.textContent = "Analyzing song…";
    div.style.cssText = `
      position: fixed; left: 50%; top: 50%; transform: translate(-50%,-50%);
      padding: 12px 18px; background: rgba(0,0,0,0.75); color: #fff;
      font: 14px/1.4 system-ui; border: 1px solid rgba(255,255,255,0.3);
      border-radius: 4px; z-index: 80;
    `;
    document.body.appendChild(div);
    this.analyzingToast = div;
  }

  private hideAnalyzingToast(): void {
    if (this.analyzingToast) {
      this.analyzingToast.remove();
      this.analyzingToast = null;
    }
  }

  start(): void {
    const tick = (): void => {
      this.rafId = requestAnimationFrame(tick);
      this.jointAnchors.tick();
      const audio: AudioFeatures = this.audioInput?.read() ?? DEFAULT_AUDIO_FEATURES;
      this.update(audio);
      this.blurPipeline.render();
    };
    tick();
  }

  private debugFrameCounter = 0;

  /** サブモジュール更新フック */
  protected update(audio: AudioFeatures): void {
    const t = performance.now() / 1000;
    const joints = this.jointAnchors.getSmoothed();
    const vis = this.jointAnchors.getVisibility();
    const center = this.jointAnchors.getCenter();
    const motion = this.jointAnchors.getMotion();

    // Build a per-frame "live" settings copy and route body motion into a
    // chosen target as a multiplicative boost. The user's persisted settings
    // stay untouched (so the GUI keeps showing their tuned value).
    const live = cloneSettings(this.settings);
    // Auto モード: ファイル再生時のみ live を上書きする。
    if (this.settings.auto.enabled
        && this.parameterAutomation
        && this.audioInput instanceof FileAudioSource) {
      const t = this.audioInput.getCurrentTime();
      this.parameterAutomation.applyAt(t, live as unknown as Record<string, unknown>);
      this.sectionTimeline.setCurrentTime(t);
    }
    if (live.motion.target !== "off") {
      const factor = 1 + motion * live.motion.strength;
      applyMotionTo(live, live.motion.target, factor);
    }

    const g = live.audioGain;
    // Apply gain, then a per-band low-pass smoothing so spikes don't hammer
    // the eye. follow=1 means instant follow, follow→0 means frozen.
    const sm = Math.max(0, Math.min(0.95, live.audioSmoothing));
    const follow = 1 - sm;
    this.smoothedAudio.volume += (audio.volume * g.volume - this.smoothedAudio.volume) * follow;
    this.smoothedAudio.bass   += (audio.bass   * g.bass   - this.smoothedAudio.bass)   * follow;
    this.smoothedAudio.mid    += (audio.mid    * g.mid    - this.smoothedAudio.mid)    * follow;
    this.smoothedAudio.treble += (audio.treble * g.treble - this.smoothedAudio.treble) * follow;
    const gainedAudio: AudioFeatures = {
      volume: this.smoothedAudio.volume,
      bass:   this.smoothedAudio.bass,
      mid:    this.smoothedAudio.mid,
      treble: this.smoothedAudio.treble,
      fft: audio.fft,
    };
    this.pointCloud.update(joints, vis, center, gainedAudio, live, t);
    this.fragmentField.update(joints, vis, center, gainedAudio, live, t);
    this.edgeOverlay.update(joints, center, gainedAudio, live, t);

    // Auto-rotate camera (handled by OrbitControls). Apply each frame so the
    // GUI slider takes effect live and motion can boost it via live.camera.
    this.orbit.autoRotate = live.camera.autoRotateSpeed !== 0;
    this.orbit.autoRotateSpeed = live.camera.autoRotateSpeed;
    // bones mode = body-driven art with floating fragments around it.
    // cube/sphere mode = single shape at the centre, fragments and skeleton
    // guides have no role and would be visual noise.
    const isBones = this.settings.mode === "bones";
    this.fragmentField.object3D.visible = isBones;
    this.skeletonGuide.update(joints, vis, center);
    // Skeleton visibility = debug toggle AND bones mode (no body to draw in
    // cube/sphere). The single source of truth lives on this.debugVisible.
    this.skeletonGuide.object3D.visible = this.debugVisible && isBones;

    // When the user changes mode, snap the camera to a sensible default
    // distance for that mode so the new shape is fully visible. Once they're
    // in a mode, OrbitControls owns the camera (mouse drag / wheel / keys).
    if (this.settings.mode !== this.lastMode) {
      const targetZ = isBones
        ? 1.0
        : Math.max(2.0, this.settings.shape.radius * 3.0 * (1.0 + this.settings.shape.bassPulse));
      this.camera.position.set(0, 0, targetZ);
      this.orbit.target.set(0, 0, 0);
      this.orbit.update();
      this.lastMode = this.settings.mode;
    }
    // SectionTimeline: auto.enabled かつ UI 表示中のみ表示 (H キーで一括非表示可)
    if (this.uiVisible && this.settings.auto.enabled) this.sectionTimeline.show();
    else this.sectionTimeline.hide();
    this.orbit.update();
    this.blurPipeline.update(live.blur, this.smoothedAudio.bass);
    // diagnostic: origin stays at world (0,0,0); centroid sits at where the
    // visibility-weighted centroid actually is. If centering is being applied
    // to PointCloud uniformly, the cluster should sit on top of the red origin.
    this.centroidMarker.position.set(center[0] ?? 0, center[1] ?? 0, center[2] ?? 0);

    // Live HUD that mirrors what the markers and shaders receive.
    if (this.diagHud.style.display !== "none") {
      const camPos = this.camera.position;
      const cm = this.centroidMarker.position;
      const pcMat = (this.pointCloud as unknown as { material: THREE.ShaderMaterial }).material;
      const pcMode = pcMat.uniforms.uMode?.value;
      const pcKeys = Object.keys(pcMat.uniforms);
      const ffVis = this.fragmentField.object3D.visible;
      this.diagHud.textContent =
        `mode = ${this.settings.mode}    uMode value = ${pcMode}\n` +
        `material.uniforms keys (${pcKeys.length}): ${pcKeys.join(", ")}\n` +
        `FragmentField.visible = ${ffVis}\n` +
        `camera.z = ${camPos.z.toFixed(2)}  fov=${this.camera.fov}  aspect=${this.camera.aspect.toFixed(2)}\n` +
        `shape: radius=${this.settings.shape.radius}  bassPulse=${this.settings.shape.bassPulse}\n` +
        `centroidMarker = (${cm.x.toFixed(3)}, ${cm.y.toFixed(3)}, ${cm.z.toFixed(3)})\n` +
        `nose joints[0..2] = (${(joints[0] ?? 0).toFixed(3)}, ${(joints[1] ?? 0).toFixed(3)}, ${(joints[2] ?? 0).toFixed(3)}) vis=${(vis[0] ?? 0).toFixed(2)}`;
    }

    // Diagnostic: log what's actually flowing into the shaders every ~2s.
    if (this.debugFrameCounter++ % 120 === 0) {
      const names = ["nose","Lshoulder","Rshoulder","Lelbow","Relbow","Lwrist","Rwrist","Lhip","Rhip","Lknee","Rknee","Lankle","Rankle"];
      const lines = names.map((n, i) => {
        const x = joints[i*3]!.toFixed(2);
        const y = joints[i*3+1]!.toFixed(2);
        const z = joints[i*3+2]!.toFixed(2);
        const v = vis[i]!.toFixed(2);
        return `${n.padEnd(10)} (${x},${y},${z}) vis=${v}`;
      });
      console.log(
        "[App.update] center=(",
        center[0]!.toFixed(2), center[1]!.toFixed(2), center[2]!.toFixed(2), ")\n" +
        lines.join("\n")
      );
    }
  }

  stop(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.poseInput?.stop();
    this.audioInput?.stop();
    this.debugOverlay?.dispose();
    this.settingsPanel.dispose();
    this.sectionTimeline.dispose();
    window.removeEventListener("resize", this.handleResize);
    window.removeEventListener("keydown", this.onKeyDown);
  }
}

function cloneSettings(s: Settings): Settings {
  return {
    mode: s.mode,
    audioGain: { ...s.audioGain },
    audioSmoothing: s.audioSmoothing,
    pointCloud: { ...s.pointCloud },
    fragmentField: { ...s.fragmentField },
    shape: { ...s.shape },
    color: { ...s.color },
    camera: { ...s.camera },
    motion: { ...s.motion },
    outlier: { ...s.outlier },
    edges: { ...s.edges },
    twist: { ...s.twist },
    blur: { ...s.blur },
    auto: { ...s.auto },
  };
}

function applyMotionTo(s: Settings, target: MotionTarget, factor: number): void {
  switch (target) {
    case "off":                          return;
    case "audioGain.volume":             s.audioGain.volume *= factor; break;
    case "audioGain.bass":               s.audioGain.bass *= factor; break;
    case "audioGain.mid":                s.audioGain.mid *= factor; break;
    case "audioGain.treble":             s.audioGain.treble *= factor; break;
    case "color.saturation":             s.color.saturation = Math.min(1, s.color.saturation * factor); break;
    case "color.hueSpread":              s.color.hueSpread = Math.min(1, s.color.hueSpread * factor); break;
    case "color.bassHueShift":           s.color.bassHueShift = Math.min(1, s.color.bassHueShift * factor); break;
    case "shape.radius":                 s.shape.radius *= factor; break;
    case "shape.bassPulse":              s.shape.bassPulse *= factor; break;
    case "pointCloud.bassExpansion":     s.pointCloud.bassExpansion *= factor; break;
    case "pointCloud.trebleShimmer":     s.pointCloud.trebleShimmer *= factor; break;
    case "pointCloud.ambientShimmer":    s.pointCloud.ambientShimmer *= factor; break;
    case "pointCloud.volumeSize":        s.pointCloud.volumeSize *= factor; break;
    case "fragmentField.driftBase":      s.fragmentField.driftBase *= factor; break;
    case "fragmentField.midDrift":       s.fragmentField.midDrift *= factor; break;
    case "fragmentField.jointPull":      s.fragmentField.jointPull *= factor; break;
    case "fragmentField.noiseScale":     s.fragmentField.noiseScale *= factor; break;
    case "fragmentField.timeSpeed":      s.fragmentField.timeSpeed *= factor; break;
    case "camera.autoRotateSpeed":       s.camera.autoRotateSpeed *= factor; break;
    case "twist.strength":               s.twist.strength *= factor; break;
    case "blur.strength":                s.blur.strength *= factor; break;
  }
}
