import { EdgeOverlay } from "../../../core/visuals/EdgeOverlay";
import type { EdgeOverlayUpdateParams } from "../../../core/visuals/params";
import type { RenderMode } from "../../../core/visuals/render-mode";
import { makeDefaultTwist } from "../../../core/visuals/twist";
import type { AudioFeatures, PoseFrame } from "../../../core/types";
import { makeEmptyJoints } from "../../../core/types";
import type { NodeState, NodeTypeDef } from "../graph/node-type";
import { VisualSurface } from "../graph/visual-surface";

/** curated（mode/anchorCount/kNeighbors/alpha/radius）からフル params を構築（純粋）。 */
export function buildEdgeParams(c: {
  mode?: RenderMode; anchorCount?: number; kNeighbors?: number; alpha?: number; radius?: number;
}): EdgeOverlayUpdateParams {
  return {
    mode: c.mode ?? "cube",
    edges: {
      enabled: true,
      anchorCount: c.anchorCount ?? 64,
      kNeighbors: c.kNeighbors ?? 2,
      alpha: c.alpha ?? 0.5,
      wave: { enabled: false, subdivisions: 8, amplitude: 0.05, audioBoost: 1.0, scale: 2.0, speed: 0.6 },
      rewire: { enabled: false, interval: 1.5, fraction: 0.3, fadeDuration: 0.4, candidatePool: 4 },
    },
    outlier: { fraction: 0.1, boost: 3.0 },
    pointCloud: { bassExpansion: 3.0, trebleShimmer: 0.05, ambientShimmer: 0.005, baseSize: 3.0, volumeSize: 8.0 },
    shape: { radius: c.radius ?? 0.4, bassPulse: 0.5, polyhedron: 6 },
    twist: makeDefaultTwist(),
  };
}

interface EdgeState {
  edge: EdgeOverlay;
  surface: VisualSurface;
}

const EMPTY_CENTER = new Float32Array(3);

/** core EdgeOverlay（アンカー間エッジ描画）を texture 出力する visual ノード。 */
export const EdgeVisualNode: NodeTypeDef = {
  type: "EdgeVisual",
  category: "visual",
  description: "アンカー点どうしを線（エッジ）で結んで描画する visual。結果を texture 出力する。",
  isSink: true,
  inputs: [
    { id: "pose", label: "pose", type: "pose", description: "bones モードでアンカー配置に使う姿勢入力。" },
    { id: "signal", label: "signal", type: "signal", description: "エッジの揺れ等を駆動する音響特徴量入力（未接続なら環境の特徴量）。" },
  ],
  outputs: [{ id: "texture", label: "tex", type: "texture", description: "描画結果のテクスチャ。" }],
  params: [
    { id: "mode", label: "mode", kind: "enum", default: "cube", options: ["bones", "cube", "sphere"], description: "アンカー配置の形状。bones=骨格 / cube=立方体 / sphere=球。" },
    { id: "anchorCount", label: "anchorCount", kind: "int", default: 64, min: 16, max: 256, step: 1, description: "エッジを張るアンカー点の数。" },
    { id: "kNeighbors", label: "kNeighbors", kind: "int", default: 2, min: 1, max: 5, step: 1, description: "各アンカーが近傍何点と線を結ぶか。" },
    { id: "alpha", label: "alpha", kind: "number", default: 0.5, min: 0, max: 1, step: 0.01, description: "エッジ線の不透明度（0〜1）。" },
    { id: "radius", label: "radius", kind: "number", default: 0.4, min: 0.05, max: 3, step: 0.01, description: "形状の半径（world m）。" },
  ],
  createState(): EdgeState {
    const edge = new EdgeOverlay();
    const surface = new VisualSurface();
    surface.scene.add(edge.object3D);
    return { edge, surface };
  },
  disposeState(state: NodeState): void {
    (state as EdgeState).surface.dispose();
  },
  evaluate(ctx) {
    const s = ctx.state as EdgeState | undefined;
    const env = ctx.env;
    if (!s || !env) return {};
    const params = buildEdgeParams({
      mode: ctx.param("mode") as RenderMode,
      anchorCount: Math.round(Number(ctx.param("anchorCount") ?? 64)),
      kNeighbors: Math.round(Number(ctx.param("kNeighbors") ?? 2)),
      alpha: Number(ctx.param("alpha") ?? 0.5),
      radius: Number(ctx.param("radius") ?? 0.4),
    });
    const pose = ctx.input("pose") as PoseFrame | undefined;
    const joints = pose?.joints ?? makeEmptyJoints();
    const center = pose?.center ?? EMPTY_CENTER;
    const audio = (ctx.input("signal") as AudioFeatures | undefined) ?? env.audio;
    s.edge.update(joints, center, audio, params, ctx.timeSec);
    const texture = s.surface.render(env.renderer, env.camera);
    return { texture };
  },
};
