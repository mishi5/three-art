import { NodeRegistry } from "../graph/node-type";
import { NumberNode } from "./NumberNode";
import { TimeNode } from "./TimeNode";
import { PulseNode } from "./PulseNode";
import { TapSequencerNode } from "./TapSequencerNode";
import { RandomValueNode } from "./RandomValueNode";
import { MultiplyNode } from "./MultiplyNode";
import { AddNode } from "./AddNode";
import { SineNode } from "./SineNode";
import { NoiseNode } from "./NoiseNode";
import { RemapNode } from "./RemapNode";
import { SmoothNode } from "./SmoothNode";
import { CameraInputNode } from "./CameraInputNode";
import { PoseFeaturesNode } from "./PoseFeaturesNode";
import { VideoFileInputNode } from "./VideoFileInputNode";
import { MicInputNode } from "./MicInputNode";
import { DisplayInputNode } from "./DisplayInputNode";
import { AudioFileInputNode } from "./AudioFileInputNode";
import { MidiPadNode } from "./MidiPadNode";
import { ImageFileInputNode } from "./ImageFileInputNode";
import { TextureGeneratorNode } from "./TextureGeneratorNode";
import { RainVisualNode } from "./RainVisualNode";
import { PointCloudVisualNode } from "./PointCloudVisualNode";
import { PointShapeNode } from "./PointShapeNode";
import { ParticleRenderNode } from "./ParticleRenderNode";
import { PointTransformNode } from "./PointTransformNode";
import { EnvelopeNode } from "./EnvelopeNode";
import { FlipFlopNode } from "./FlipFlopNode";
import { AutomationNode } from "./AutomationNode";
import { TextureSequencerNode } from "./TextureSequencerNode";
import { BlendNode } from "./BlendNode";
import { KeyNode } from "./KeyNode";
import { BlurNode } from "./BlurNode";
import { BloomNode } from "./BloomNode";
import { RgbShiftNode } from "./RgbShiftNode";
import { PixelateNode } from "./PixelateNode";
import { ColorGradeNode } from "./ColorGradeNode";
import { CrtNode } from "./CrtNode";
import { KaleidoscopeNode } from "./KaleidoscopeNode";
import { FractalNode } from "./FractalNode";
import { DistortNode } from "./DistortNode";
import { FeedbackNode } from "./FeedbackNode";
import { FlashNode } from "./FlashNode";
import { TextureTransformNode } from "./TextureTransformNode";
import { EdgeVisualNode } from "./EdgeVisualNode";
import { GraphVisualNode } from "./GraphVisualNode";
import { AudioMixNode } from "./AudioMixNode";
import { AudioDelayNode } from "./AudioDelayNode";
import { AudioFilterNode } from "./AudioFilterNode";
import { AudioGainNode } from "./AudioGainNode";
import { AudioReverbNode } from "./AudioReverbNode";
import { AudioOutputNode } from "./AudioOutputNode";
import { ScreenNode } from "./ScreenNode";
import { SceneInputNode } from "./SceneInputNode";

/** 既定ノードを登録したレジストリを返す。
 *  #227: 登録順はメニュー内の表示順（カテゴリ内）になるため、NODE_CATEGORIES の並びで揃える。 */
export function createDefaultRegistry(): NodeRegistry {
  const r = new NodeRegistry();
  // source（外部入力・値/映像の発生源）
  r.register(CameraInputNode);
  r.register(MicInputNode);
  r.register(DisplayInputNode);
  r.register(VideoFileInputNode);
  r.register(AudioFileInputNode);
  r.register(ImageFileInputNode);
  r.register(SceneInputNode);
  r.register(MidiPadNode);
  r.register(TextureGeneratorNode);
  r.register(NumberNode);
  r.register(TimeNode);
  // control（数値の生成・変換・制御）
  r.register(SineNode);
  r.register(NoiseNode);
  r.register(RandomValueNode);
  r.register(PulseNode);
  r.register(TapSequencerNode);
  r.register(AutomationNode);
  r.register(FlipFlopNode);
  r.register(EnvelopeNode);
  r.register(AddNode);
  r.register(MultiplyNode);
  r.register(RemapNode);
  r.register(SmoothNode);
  r.register(PoseFeaturesNode);
  // audio（音声の加工・ルーティング）
  r.register(AudioMixNode);
  r.register(AudioDelayNode);
  r.register(AudioFilterNode);
  r.register(AudioGainNode);
  r.register(AudioReverbNode);
  // render（点群・形状の生成と描画）
  r.register(PointShapeNode);
  r.register(PointTransformNode);
  r.register(ParticleRenderNode);
  r.register(PointCloudVisualNode);
  r.register(EdgeVisualNode);
  r.register(RainVisualNode);
  r.register(GraphVisualNode);
  // composite（テクスチャの合成・切替）
  r.register(BlendNode);
  r.register(KeyNode);
  r.register(TextureSequencerNode);
  // effect（texture→texture）
  r.register(BloomNode);
  r.register(BlurNode);
  r.register(ColorGradeNode);
  r.register(CrtNode);
  r.register(DistortNode);
  r.register(FeedbackNode);
  r.register(FlashNode);
  r.register(FractalNode);
  r.register(KaleidoscopeNode);
  r.register(PixelateNode);
  r.register(RgbShiftNode);
  r.register(TextureTransformNode);
  // output（最終出力）
  r.register(ScreenNode);
  r.register(AudioOutputNode);
  return r;
}
