import { NodeRegistry } from "../graph/node-type";
import { NumberNode } from "./NumberNode";
import { TimeNode } from "./TimeNode";
import { MultiplyNode } from "./MultiplyNode";
import { PoseInputNode } from "./PoseInputNode";
import { AudioInputNode } from "./AudioInputNode";
import { RainVisualNode } from "./RainVisualNode";

/** 既定ノードを登録したレジストリを返す。 */
export function createDefaultRegistry(): NodeRegistry {
  const r = new NodeRegistry();
  r.register(NumberNode);
  r.register(TimeNode);
  r.register(MultiplyNode);
  r.register(PoseInputNode);
  r.register(AudioInputNode);
  r.register(RainVisualNode);
  return r;
}
