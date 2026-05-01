import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { AudioInput } from "./audio/AudioInput";
import { JointAnchors } from "./pose/JointAnchors";
import { PoseInput } from "./pose/PoseInput";
import { DEFAULT_AUDIO_FEATURES, type AudioFeatures } from "./types";
import { PointCloud } from "./visuals/PointCloud";
import { FragmentField } from "./visuals/FragmentField";
import { SkeletonGuide } from "./visuals/SkeletonGuide";
import { DebugOverlay } from "./ui/DebugOverlay";
import { SettingsPanel } from "./ui/SettingsPanel";
import { loadSettings, type Settings, type RenderMode, type MotionTarget } from "./settings";

export class App {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly jointAnchors = new JointAnchors();
  readonly pointCloud: PointCloud;
  readonly fragmentField: FragmentField;
  readonly skeletonGuide: SkeletonGuide;
  readonly originMarker: THREE.Mesh;
  readonly centroidMarker: THREE.Mesh;
  private diagHud: HTMLDivElement;
  private debugVisible = false;
  readonly settings: Settings = loadSettings();
  private settingsPanel: SettingsPanel;
  private orbit: OrbitControls;
  private lastMode: RenderMode | null = null;
  private poseInput: PoseInput | null = null;
  private debugOverlay: DebugOverlay | null = null;
  private audioInput: AudioInput | null = null;
  private audioCtx: AudioContext | null = null;
  private rafId: number | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.scene.background = new THREE.Color(0x000000);
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.01, 100);
    // 体（centering 後の visible 関節が原点まわり ±0.25m くらい）が画面の
    // 過半を占めるよう、カメラを近づける（2.5m → 1.0m）。
    this.camera.position.set(0, 0, 1.0);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.handleResize();
    this.pointCloud = new PointCloud(this.renderer.getPixelRatio());
    this.scene.add(this.pointCloud.object3D);
    this.fragmentField = new FragmentField(this.renderer.getPixelRatio());
    this.scene.add(this.fragmentField.object3D);
    this.skeletonGuide = new SkeletonGuide();
    this.scene.add(this.skeletonGuide.object3D);

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

    this.settingsPanel = new SettingsPanel(this.settings);

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
  };

  getOrCreateAudioContext(): AudioContext {
    if (!this.audioCtx) this.audioCtx = new AudioContext();
    return this.audioCtx;
  }

  setAudio(audio: AudioInput | null): void {
    this.audioInput?.stop();
    this.audioInput = audio;
  }

  start(): void {
    const tick = (): void => {
      this.rafId = requestAnimationFrame(tick);
      this.jointAnchors.tick();
      const audio: AudioFeatures = this.audioInput?.read() ?? DEFAULT_AUDIO_FEATURES;
      this.update(audio);
      this.renderer.render(this.scene, this.camera);
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
    if (live.motion.target !== "off") {
      const factor = 1 + motion * live.motion.strength;
      applyMotionTo(live, live.motion.target, factor);
    }

    const g = live.audioGain;
    const gainedAudio: AudioFeatures = {
      volume: audio.volume * g.volume,
      bass: audio.bass * g.bass,
      mid: audio.mid * g.mid,
      treble: audio.treble * g.treble,
      fft: audio.fft,
    };
    this.pointCloud.update(joints, vis, center, gainedAudio, live, t);
    this.fragmentField.update(joints, vis, center, gainedAudio, live, t);

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
    this.orbit.update();
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
    window.removeEventListener("resize", this.handleResize);
    window.removeEventListener("keydown", this.onKeyDown);
  }
}

function cloneSettings(s: Settings): Settings {
  return {
    mode: s.mode,
    audioGain: { ...s.audioGain },
    pointCloud: { ...s.pointCloud },
    fragmentField: { ...s.fragmentField },
    shape: { ...s.shape },
    color: { ...s.color },
    camera: { ...s.camera },
    motion: { ...s.motion },
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
  }
}
