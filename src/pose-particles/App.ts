import * as THREE from "three";
import type { AudioInput } from "./audio/AudioInput";
import { JointAnchors } from "./pose/JointAnchors";
import { PoseInput } from "./pose/PoseInput";
import { DEFAULT_AUDIO_FEATURES, type AudioFeatures } from "./types";
import { PointCloud } from "./visuals/PointCloud";
import { FragmentField } from "./visuals/FragmentField";
import { SkeletonGuide } from "./visuals/SkeletonGuide";
import { DebugOverlay } from "./ui/DebugOverlay";
import { SettingsPanel } from "./ui/SettingsPanel";
import { makeDefaultSettings, type Settings } from "./settings";

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
  readonly settings: Settings = makeDefaultSettings();
  private settingsPanel: SettingsPanel;
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
    if (e.key === "b" || e.key === "B") {
      const visible = this.skeletonGuide.toggle();
      this.originMarker.visible = visible;
      this.centroidMarker.visible = visible;
      this.diagHud.style.display = visible ? "block" : "none";
      console.log(`[App] 3D debug overlays: ${visible ? "ON" : "OFF"}`);
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
    const g = this.settings.audioGain;
    const gainedAudio: AudioFeatures = {
      volume: audio.volume * g.volume,
      bass: audio.bass * g.bass,
      mid: audio.mid * g.mid,
      treble: audio.treble * g.treble,
      fft: audio.fft,
    };
    this.pointCloud.update(joints, vis, center, gainedAudio, this.settings, t);
    this.fragmentField.update(joints, vis, center, gainedAudio, this.settings, t);
    // bones mode = body-driven art with floating fragments around it.
    // cube/sphere mode = single shape at the centre, fragments and skeleton
    // guides have no role and would be visual noise.
    const isBones = this.settings.mode === "bones";
    this.fragmentField.object3D.visible = isBones;
    this.skeletonGuide.update(joints, vis, center);
    if (!isBones) this.skeletonGuide.object3D.visible = false;
    // diagnostic: origin stays at world (0,0,0); centroid sits at where the
    // visibility-weighted centroid actually is. If centering is being applied
    // to PointCloud uniformly, the cluster should sit on top of the red origin.
    this.centroidMarker.position.set(center[0] ?? 0, center[1] ?? 0, center[2] ?? 0);

    // Live HUD that mirrors what the markers and shaders receive.
    if (this.diagHud.style.display !== "none") {
      const camPos = this.camera.position;
      const camRot = this.camera.rotation;
      const cm = this.centroidMarker.position;
      const om = this.originMarker.position;
      this.diagHud.textContent =
        `camera.position = (${camPos.x.toFixed(2)}, ${camPos.y.toFixed(2)}, ${camPos.z.toFixed(2)})\n` +
        `camera.rotation = (${camRot.x.toFixed(2)}, ${camRot.y.toFixed(2)}, ${camRot.z.toFixed(2)})\n` +
        `aspect=${this.camera.aspect.toFixed(3)}  fov=${this.camera.fov}\n` +
        `originMarker pos = (${om.x.toFixed(2)}, ${om.y.toFixed(2)}, ${om.z.toFixed(2)})  -- expected (0,0,0)\n` +
        `centroidMarker pos = (${cm.x.toFixed(3)}, ${cm.y.toFixed(3)}, ${cm.z.toFixed(3)})\n` +
        `JointAnchors.center = (${(center[0] ?? 0).toFixed(3)}, ${(center[1] ?? 0).toFixed(3)}, ${(center[2] ?? 0).toFixed(3)})\n` +
        `nose joints[0..2] = (${(joints[0] ?? 0).toFixed(3)}, ${(joints[1] ?? 0).toFixed(3)}, ${(joints[2] ?? 0).toFixed(3)})  vis=${(vis[0] ?? 0).toFixed(2)}\n` +
        `nose - center     = (${((joints[0] ?? 0) - (center[0] ?? 0)).toFixed(3)}, ${((joints[1] ?? 0) - (center[1] ?? 0)).toFixed(3)}, ${((joints[2] ?? 0) - (center[2] ?? 0)).toFixed(3)})`;
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
