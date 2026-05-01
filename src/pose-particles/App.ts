import * as THREE from "three";
import type { AudioInput } from "./audio/AudioInput";
import { JointAnchors } from "./pose/JointAnchors";
import { PoseInput } from "./pose/PoseInput";
import { DEFAULT_AUDIO_FEATURES, type AudioFeatures } from "./types";
import { PointCloud } from "./visuals/PointCloud";
import { FragmentField } from "./visuals/FragmentField";
import { DebugOverlay } from "./ui/DebugOverlay";

export class App {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly jointAnchors = new JointAnchors();
  readonly pointCloud: PointCloud;
  readonly fragmentField: FragmentField;
  private poseInput: PoseInput | null = null;
  private debugOverlay: DebugOverlay | null = null;
  private audioInput: AudioInput | null = null;
  private audioCtx: AudioContext | null = null;
  private rafId: number | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.scene.background = new THREE.Color(0x000000);
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.01, 100);
    this.camera.position.set(0, 0, 2.5);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.handleResize();
    this.pointCloud = new PointCloud(this.renderer.getPixelRatio());
    this.scene.add(this.pointCloud.object3D);
    this.fragmentField = new FragmentField(this.renderer.getPixelRatio());
    this.scene.add(this.fragmentField.object3D);
    window.addEventListener("resize", this.handleResize);
  }

  private handleResize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
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
    this.pointCloud.update(joints, vis, center, audio, t);
    this.fragmentField.update(joints, vis, center, audio, t);

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
    window.removeEventListener("resize", this.handleResize);
  }
}
