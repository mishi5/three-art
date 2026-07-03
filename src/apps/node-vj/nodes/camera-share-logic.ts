// #214: 共有カメラの自動停止判定（純ロジック・テスト可能に分離）。
import type { GraphDoc } from "../graph/graph-doc";

/** CameraInput ノードの type 名（判定の単一情報源）。 */
export const CAMERA_INPUT_TYPE = "CameraInput";

/** 与えられた全 GraphDoc のいずれかに CameraInput ノードが存在するか。 */
export function anyGraphHasCameraInput(graphs: readonly GraphDoc[]): boolean {
  return graphs.some((g) => g.nodes.some((n) => n.type === CAMERA_INPUT_TYPE));
}

/**
 * 共有カメラを自動停止すべきか（純関数）。
 * カメラ稼働中 かつ 全シーンから CameraInput が消えている とき true。
 * 稼働していなければ何もしないので false。
 */
export function shouldAutoStopCamera(graphs: readonly GraphDoc[], cameraStarted: boolean): boolean {
  return cameraStarted && !anyGraphHasCameraInput(graphs);
}
