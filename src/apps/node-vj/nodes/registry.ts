import { NodeRegistry } from "../graph/node-type";
import { NumberNode } from "./NumberNode";
import { TimeNode } from "./TimeNode";
import { MultiplyNode } from "./MultiplyNode";
import { RainVisualNode } from "./RainVisualNode";

/** #60 MVP の既定ノードを登録したレジストリを返す。 */
export function createDefaultRegistry(): NodeRegistry {
  const r = new NodeRegistry();
  r.register(NumberNode);
  r.register(TimeNode);
  r.register(MultiplyNode);
  r.register(RainVisualNode);
  return r;
}
