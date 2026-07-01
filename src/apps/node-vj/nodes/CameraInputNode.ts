import * as THREE from "three";
import { JointAnchors } from "../../../core/pose/JointAnchors";
import { PoseInput } from "../../../core/pose/PoseInput";
import type { PoseFrame } from "../../../core/types";
import { makeEmptyJoints, NUM_JOINTS } from "../../../core/types";
import type { NodeInstance } from "../graph/graph-doc";
import type { NodeState, NodeTypeDef } from "../graph/node-type";
import { PREVIEW_W, PREVIEW_H } from "../graph/preview";
import { containRect } from "../editor/fit";
import { VideoTextureSurface } from "../graph/video-surface";
import { sharedCamera } from "./shared-camera";

/** 骨格重畳に使う主要エッジ（MediaPipe Pose の landmark index）。 */
const SKELETON_EDGES: ReadonlyArray<[number, number]> = [
  [11, 12],
  [11, 13], [13, 15],
  [12, 14], [14, 16],
  [11, 23], [12, 24],
  [23, 24],
  [23, 25], [25, 27],
  [24, 26], [26, 28],
];

type Landmark = { x: number; y: number };

/**
 * CameraInput ノードの永続状態（#66 / #214）。
 * カメラ（MediaStream・隠し <video>）は共有カメラ（sharedCamera）が所有し、本 Runtime は
 * それにアタッチするだけ（シーン切替で state が破棄されても stream は落ちない）。
 * 姿勢推定（MediaPipe）は poseDetect=on のときだけ遅延起動する（ノード単位）。
 * カメラ起動は user gesture が必要なため start() は外部（起動ボタン）から呼ぶ。
 */
export class CameraInputRuntime {
  readonly anchors = new JointAnchors();
  private pose: PoseInput | null = null;
  private poseStarting = false;
  private surface = new VideoTextureSurface();
  private lastLandmarks: Landmark[] | null = null;
  private previewCanvas: HTMLCanvasElement | null = null;

  /** 共有カメラの隠し <video>（複数 CameraInput ノードで共有）。 */
  private get video(): HTMLVideoElement {
    return sharedCamera.video;
  }

  /** カメラが稼働中か（共有カメラの状態に追従）。 */
  get started(): boolean {
    return sharedCamera.started;
  }

  /** カメラを開始する（共有カメラへ委譲・冪等）。姿勢推定は evaluate 側で遅延起動。 */
  async start(): Promise<void> {
    await sharedCamera.start();
  }

  /** poseDetect=on で呼ばれる。多重起動を防ぎつつ MediaPipe を遅延起動。 */
  ensurePose(): void {
    if (this.pose || this.poseStarting || !this.started) return;
    this.poseStarting = true;
    const p = new PoseInput((result) => {
      this.anchors.update(result);
      const lm = (result as { landmarks?: Landmark[][] }).landmarks?.[0];
      this.lastLandmarks = lm ?? null;
    });
    p.start(this.video)
      .then(() => { this.pose = p; })
      .catch((e) => console.warn("[CameraInput] pose start failed:", e))
      .finally(() => { this.poseStarting = false; });
  }

  /** poseDetect=off で推定を止める（カメラは生かす）。 */
  stopPose(): void {
    this.pose?.stop();
    this.pose = null;
    this.lastLandmarks = null;
  }

  /**
   * カメラ映像の texture（映像が来るまでは null）。
   * 生の VideoTexture でなく、画面サイズ RT へ contain 描画した texture を返す
   * （Screen/エフェクトで横伸びしないようアスペクト比を入口で正規化）。
   */
  getTexture(renderer: THREE.WebGLRenderer): THREE.Texture | null {
    if (!this.started) return null;
    return this.surface.render(renderer, this.video);
  }

  /** プレビュー小窓のフレーム合成（#79 と同仕様）。 */
  previewFrame(skeleton: boolean): CanvasImageSource | null {
    if (!this.started || this.video.videoWidth === 0) return null;
    if (!this.previewCanvas) {
      this.previewCanvas = document.createElement("canvas");
      this.previewCanvas.width = PREVIEW_W;
      this.previewCanvas.height = PREVIEW_H;
    }
    const ctx = this.previewCanvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, PREVIEW_W, PREVIEW_H);
    const fit = containRect(this.video.videoWidth, this.video.videoHeight, PREVIEW_W, PREVIEW_H);
    ctx.drawImage(this.video, fit.x, fit.y, fit.w, fit.h);
    if (skeleton && this.lastLandmarks) {
      const px = (l: Landmark): [number, number] => [fit.x + l.x * fit.w, fit.y + l.y * fit.h];
      ctx.strokeStyle = "#6c9";
      ctx.fillStyle = "#6c9";
      ctx.lineWidth = 1.5;
      for (const [a, b] of SKELETON_EDGES) {
        const la = this.lastLandmarks[a];
        const lb = this.lastLandmarks[b];
        if (!la || !lb) continue;
        const [ax, ay] = px(la);
        const [bx, by] = px(lb);
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
        ctx.beginPath(); ctx.arc(ax, ay, 2, 0, Math.PI * 2); ctx.fill();
      }
    }
    return this.previewCanvas;
  }

  /**
   * #214: state 破棄時は pose と描画資源だけ解放し、共有カメラの stream/video は止めない。
   * カメラの停止は「入力停止」ボタン / 全シーンから CameraInput 消失時の自動停止 / unload が担う。
   */
  dispose(): void {
    this.stopPose();
    this.surface.dispose();
  }
}

/**
 * カメラ入力ノード（#66・旧 PoseInput を統合）。
 * texture（カメラ映像）+ pose を出力。poseDetect=off なら姿勢推定を
 * 動かさない（映像のみ・推定コストゼロ）。動き量は PoseFeatures ノード（#185）へ集約。
 */
export const CameraInputNode: NodeTypeDef = {
  type: "CameraInput",
  category: "input",
  description: "カメラ映像と姿勢推定を入力するノード。映像 texture・骨格 pose を出力する（動き量は PoseFeatures へ）。",
  isSink: false,
  inputs: [],
  outputs: [
    { id: "texture", label: "tex", type: "texture", description: "カメラ映像のテクスチャ（アスペクト比を入口で正規化済み）。" },
    { id: "pose", label: "pose", type: "pose", description: "MediaPipe Pose で推定した骨格（poseDetect=off なら空）。" },
  ],
  params: [
    { id: "poseDetect", label: "poseDetect", kind: "enum", default: "on", options: ["on", "off"], description: "姿勢推定の ON/OFF。off なら映像のみ供給し推定コストをゼロにする。" },
    { id: "skeleton", label: "skeleton", kind: "enum", default: "off", options: ["off", "on"], description: "プレビュー小窓に骨格線を重畳表示するか。" },
  ],
  createState: () => new CameraInputRuntime(),
  disposeState: (state: NodeState) => (state as CameraInputRuntime).dispose(),
  previewSource: (state: NodeState, node: NodeInstance) =>
    (state as CameraInputRuntime).previewFrame(node.params.skeleton === "on"),
  evaluate: (ctx) => {
    const s = ctx.state as CameraInputRuntime | undefined;
    const empty: PoseFrame = {
      joints: makeEmptyJoints(), visibility: new Float32Array(NUM_JOINTS), center: new Float32Array(3),
    };
    if (!s) return { texture: undefined, pose: empty };
    // poseDetect に応じて推定を遅延起動/停止（カメラは維持）
    if (ctx.param("poseDetect") === "on") s.ensurePose();
    else s.stopPose();
    s.anchors.tick();
    const pose: PoseFrame = {
      joints: s.anchors.getSmoothed(),
      visibility: s.anchors.getVisibility(),
      center: s.anchors.getCenter(),
    };
    return {
      texture: (ctx.env ? s.getTexture(ctx.env.renderer) : null) ?? undefined,
      pose,
    };
  },
};
