import { JointAnchors } from "../../../core/pose/JointAnchors";
import { PoseInput } from "../../../core/pose/PoseInput";
import type { PoseFrame } from "../../../core/types";
import { makeEmptyJoints, NUM_JOINTS } from "../../../core/types";
import type { NodeState, NodeTypeDef } from "../graph/node-type";

/**
 * PoseInput ノードの永続状態。MediaPipe Pose + JointAnchors を保持する。
 * カメラ起動は user gesture が必要なため createState では開始せず、start() を
 * 外部（main の起動ボタン）から呼ぶ。
 */
export class PoseInputRuntime {
  readonly anchors = new JointAnchors();
  private pose: PoseInput | null = null;
  started = false;

  async start(): Promise<void> {
    if (this.started) return;
    this.pose = new PoseInput((result) => this.anchors.update(result));
    await this.pose.start();
    this.started = true;
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
  params: [],
  createState: () => new PoseInputRuntime(),
  disposeState: (state: NodeState) => (state as PoseInputRuntime).dispose(),
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
