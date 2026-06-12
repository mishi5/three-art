import { NodeRegistry } from "../graph/node-type";
import { NumberNode } from "./NumberNode";
import { TimeNode } from "./TimeNode";
import { MultiplyNode } from "./MultiplyNode";
import { AddNode } from "./AddNode";
import { SineNode } from "./SineNode";
import { NoiseNode } from "./NoiseNode";
import { RemapNode } from "./RemapNode";
import { SmoothNode } from "./SmoothNode";
import { PoseInputNode } from "./PoseInputNode";
import { AudioInputNode } from "./AudioInputNode";
import { RainVisualNode } from "./RainVisualNode";
import { PointCloudVisualNode } from "./PointCloudVisualNode";
import { BlendNode } from "./BlendNode";
import { ScreenNode } from "./ScreenNode";

/** 既定ノードを登録したレジストリを返す。 */
export function createDefaultRegistry(): NodeRegistry {
  const r = new NodeRegistry();
  // input
  r.register(NumberNode);
  r.register(TimeNode);
  r.register(PoseInputNode);
  r.register(AudioInputNode);
  // process
  r.register(MultiplyNode);
  r.register(AddNode);
  r.register(SineNode);
  r.register(NoiseNode);
  r.register(RemapNode);
  r.register(SmoothNode);
  // visual
  r.register(PointCloudVisualNode);
  r.register(RainVisualNode);
  r.register(BlendNode);
  // output
  r.register(ScreenNode);
  return r;
}
