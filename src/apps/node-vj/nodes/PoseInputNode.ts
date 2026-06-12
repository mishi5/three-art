import { JointAnchors } from "../../../core/pose/JointAnchors";
import { PoseInput } from "../../../core/pose/PoseInput";
import type { PoseFrame } from "../../../core/types";
import { makeEmptyJoints, NUM_JOINTS } from "../../../core/types";
import type { NodeInstance } from "../graph/graph-doc";
import type { NodeState, NodeTypeDef } from "../graph/node-type";
import { PREVIEW_W, PREVIEW_H } from "../graph/preview";
import { containRect } from "../editor/fit";

/** 骨格重畳に使う主要エッジ（MediaPipe Pose の landmark index）。 */
const SKELETON_EDGES: ReadonlyArray<[number, number]> = [
  [11, 12],            // 肩-肩
  [11, 13], [13, 15],  // 左 肩-肘-手首
  [12, 14], [14, 16],  // 右 肩-肘-手首
  [11, 23], [12, 24],  // 肩-腰
  [23, 24],            // 腰-腰
  [23, 25], [25, 27],  // 左 腰-膝-足首
  [24, 26], [26, 28],  // 右 腰-膝-足首
];

type Landmark = { x: number; y: number };

/**
 * PoseInput ノードの永続状態。MediaPipe Pose + JointAnchors を保持する。
 * カメラ起動は user gesture が必要なため createState では開始せず、start() を
 * 外部（main の起動ボタン）から呼ぶ。
 */
export class PoseInputRuntime {
  readonly anchors = new JointAnchors();
  private pose: PoseInput | null = null;
  /** 骨格重畳用の最新 MediaPipe 正規化 landmark（未検出は null）。 */
  private lastLandmarks: Landmark[] | null = null;
  /** プレビュー合成先（video の contain 描画＋骨格重畳）。 */
  private previewCanvas: HTMLCanvasElement | null = null;
  started = false;

  async start(): Promise<void> {
    if (this.started) return;
    this.pose = new PoseInput((result) => {
      this.anchors.update(result);
      const lm = (result as { landmarks?: Landmark[][] }).landmarks?.[0];
      this.lastLandmarks = lm ?? null;
    });
    await this.pose.start();
    this.started = true;
  }

  /**
   * プレビュー小窓のフレームを合成して返す（#79）。
   * カメラ未開始・映像未着のときは null（エディタ側で no signal 表示）。
   */
  previewFrame(skeleton: boolean): CanvasImageSource | null {
    const video = this.pose?.getVideo();
    if (!this.started || !video || video.videoWidth === 0) return null;
    if (!this.previewCanvas) {
      this.previewCanvas = document.createElement("canvas");
      this.previewCanvas.width = PREVIEW_W;
      this.previewCanvas.height = PREVIEW_H;
    }
    const ctx = this.previewCanvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, PREVIEW_W, PREVIEW_H);
    const fit = containRect(video.videoWidth, video.videoHeight, PREVIEW_W, PREVIEW_H);
    ctx.drawImage(video, fit.x, fit.y, fit.w, fit.h);
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

  dispose(): void {
    this.pose?.stop();
  }
}

/** pose 入力ノード。pose バンドルと motion(number) を出力する。 */
export const PoseInputNode: NodeTypeDef = {
  type: "PoseInput",
  category: "input",
  isSink: false,
  inputs: [],
  outputs: [
    { id: "pose", label: "pose", type: "pose" },
    { id: "motion", label: "motion", type: "number" },
  ],
  params: [
    // プレビュー小窓に骨格を重畳するか（#79）。プレビュー自体の ON/OFF は 👁。
    { id: "skeleton", label: "skeleton", kind: "boolean", default: false },
  ],
  createState: () => new PoseInputRuntime(),
  disposeState: (state: NodeState) => (state as PoseInputRuntime).dispose(),
  // #79: カメラ映像のノード隣接プレビュー（texture を持たないため previewSource で提供）
  previewSource: (state: NodeState, node: NodeInstance) =>
    (state as PoseInputRuntime).previewFrame(Boolean(node.params.skeleton)),
  evaluate: (ctx) => {
    const s = ctx.state as PoseInputRuntime | undefined;
    if (!s) {
      const empty: PoseFrame = {
        joints: makeEmptyJoints(), visibility: new Float32Array(NUM_JOINTS), center: new Float32Array(3),
      };
      return { pose: empty, motion: 0 };
    }
    s.anchors.tick();
    const pose: PoseFrame = {
      joints: s.anchors.getSmoothed(),
      visibility: s.anchors.getVisibility(),
      center: s.anchors.getCenter(),
    };
    return { pose, motion: s.anchors.getMotion() };
  },
};
