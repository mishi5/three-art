import { NodeRegistry } from "../graph/node-type";
import { NumberNode } from "./NumberNode";
import { TimeNode } from "./TimeNode";
import { MultiplyNode } from "./MultiplyNode";
import { AddNode } from "./AddNode";
import { SineNode } from "./SineNode";
import { NoiseNode } from "./NoiseNode";
import { RemapNode } from "./RemapNode";
import { SmoothNode } from "./SmoothNode";
import { CameraInputNode } from "./CameraInputNode";
import { VideoFileInputNode } from "./VideoFileInputNode";
import { MicInputNode } from "./MicInputNode";
import { DisplayAudioInputNode } from "./DisplayAudioInputNode";
import { AudioFileInputNode } from "./AudioFileInputNode";
import { RainVisualNode } from "./RainVisualNode";
import { PointCloudVisualNode } from "./PointCloudVisualNode";
import { PointShapeNode } from "./PointShapeNode";
import { ParticleRenderNode } from "./ParticleRenderNode";
import { PointTransformNode } from "./PointTransformNode";
import { EnvelopeNode } from "./EnvelopeNode";
import { FlipFlopNode } from "./FlipFlopNode";
import { BlendNode } from "./BlendNode";
import { BlurNode } from "./BlurNode";
import { KaleidoscopeNode } from "./KaleidoscopeNode";
import { FractalNode } from "./FractalNode";
import { EdgeVisualNode } from "./EdgeVisualNode";
import { ScreenNode } from "./ScreenNode";

/** 既定ノードを登録したレジストリを返す。 */
export function createDefaultRegistry(): NodeRegistry {
  const r = new NodeRegistry();
  // input
  r.register(NumberNode);
  r.register(TimeNode);
  r.register(CameraInputNode);
  r.register(VideoFileInputNode);
  r.register(MicInputNode);
  r.register(DisplayAudioInputNode);
  r.register(AudioFileInputNode);
  r.register(PointShapeNode);
  // process
  r.register(MultiplyNode);
  r.register(AddNode);
  r.register(SineNode);
  r.register(NoiseNode);
  r.register(RemapNode);
  r.register(SmoothNode);
  r.register(PointTransformNode);
  r.register(EnvelopeNode);
  r.register(FlipFlopNode);
  // visual
  r.register(PointCloudVisualNode);
  r.register(ParticleRenderNode);
  r.register(RainVisualNode);
  r.register(BlendNode);
  r.register(EdgeVisualNode);
  // effect（texture→texture）
  r.register(BlurNode);
  r.register(KaleidoscopeNode);
  r.register(FractalNode);
  // output
  r.register(ScreenNode);
  return r;
}
