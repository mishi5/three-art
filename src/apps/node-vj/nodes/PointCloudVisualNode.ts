import { PointCloud } from "../../../core/visuals/PointCloud";
import { sampleImageToGrid } from "../../../core/visuals/ImageSampler";
import type { PoseFrame, AudioFeatures } from "../../../core/types";
import { makeEmptyJoints, NUM_JOINTS } from "../../../core/types";
import type { NodeEnv, NodeState, NodeTypeDef } from "../graph/node-type";
import { VisualSurface } from "../graph/visual-surface";
import { buildPointCloudParams, type PointCloudCurated } from "./pointcloud-params";
// バンドル済みデフォルト画像（image モード用）。Bun の file loader が URL に解決する。
import sampleImageUrl from "../../pose-particles/ui/assets/sample-01.svg";

interface PointCloudState {
  pc: PointCloud;
  surface: VisualSurface;
}

const DEFAULT_GRID_W = 80;
const DEFAULT_GRID_H = 60;

const EMPTY_VIS = new Float32Array(NUM_JOINTS);
const EMPTY_CENTER = new Float32Array(3);

/** image モード用にデフォルト画像を読み込み、グリッド化して setImage する。 */
function loadDefaultImage(pc: PointCloud): void {
  const img = new Image();
  img.onload = () => {
    try {
      const grid = sampleImageToGrid(img, DEFAULT_GRID_W, DEFAULT_GRID_H);
      pc.setImage(grid, DEFAULT_GRID_W, DEFAULT_GRID_H);
    } catch (e) {
      console.warn("[PointCloudVisual] default image sampling failed:", e);
    }
  };
  img.onerror = () => console.warn("[PointCloudVisual] default image load failed");
  img.src = sampleImageUrl;
}

/** PointCloud + 各レンダリングモードを駆動する visual sink ノード。 */
export const PointCloudVisualNode: NodeTypeDef = {
  type: "PointCloudVisual",
  category: "visual",
  description: "pose と audio から点群を描画する visual。形状モードを切り替え、結果を texture 出力する。",
  isSink: true,
  inputs: [
    { id: "pose", label: "pose", type: "pose", description: "bones/image モードで骨格に追従させる姿勢入力。" },
    { id: "audio", label: "audio", type: "audio", description: "音響特徴量入力（未接続なら環境の audio を使う）。" },
  ],
  outputs: [{ id: "texture", label: "tex", type: "texture", description: "描画結果のテクスチャ（Screen やエフェクトへ繋ぐ）。" }],
  params: [
    { id: "mode", label: "mode", kind: "enum", default: "cube", options: ["bones", "cube", "sphere", "lattice", "image"], description: "形状モード。bones=骨格 / cube/sphere/lattice=幾何形状 / image=画像サンプル。" },
    { id: "radius", label: "radius", kind: "number", default: 0.4, min: 0.05, max: 3, step: 0.01, description: "形状の半径（world m）。" },
    { id: "bassPulse", label: "bassPulse", kind: "number", default: 0.5, min: 0, max: 2, step: 0.05, description: "bass に合わせた拍動の強さ。" },
    { id: "polyhedron", label: "polyhedron", kind: "enum", default: "6", options: ["4", "6", "8", "12"], description: "多面体の面数（4/6/8/12）。" },
    { id: "hueBase", label: "hueBase", kind: "number", default: 0.6, min: 0, max: 1, step: 0.01, description: "基準色相（0〜1）。" },
    { id: "hueSpread", label: "hueSpread", kind: "number", default: 0.4, min: 0, max: 1, step: 0.01, description: "色相の広がり幅（粒子間の色のばらつき）。" },
    { id: "saturation", label: "saturation", kind: "number", default: 0.6, min: 0, max: 1, step: 0.01, description: "彩度（0〜1）。" },
    { id: "bassExpansion", label: "bassExpansion", kind: "number", default: 3.0, min: 0, max: 10, step: 0.1, description: "bass による粒子の膨張量。" },
    { id: "baseSize", label: "baseSize", kind: "number", default: 3.0, min: 0.5, max: 10, step: 0.1, description: "粒子の基本サイズ。" },
    { id: "volumeSize", label: "volumeSize", kind: "number", default: 8.0, min: 0, max: 20, step: 0.1, description: "音量に応じて粒子サイズを増す量。" },
    { id: "twistStrength", label: "twistStrength", kind: "number", default: 0, min: 0, max: 5, step: 0.1, description: "ねじり変形の強さ（0 でねじらない）。" },
    { id: "twistAxis", label: "twistAxis", kind: "enum", default: "y", options: ["x", "y", "z"], description: "ねじりの軸。" },
    { id: "latticeResolution", label: "latticeRes", kind: "int", default: 12, min: 8, max: 17, step: 1, description: "lattice モードの格子解像度（1 辺の分割数）。" },
    { id: "latticeWaveAmplitude", label: "latticeWaveAmp", kind: "number", default: 0.15, min: 0, max: 0.5, step: 0.01, description: "lattice モードの波打ち振幅。" },
    { id: "gridW", label: "gridW", kind: "int", default: 80, min: 8, max: 120, step: 1, description: "image モードのサンプリング横解像度。" },
    { id: "gridH", label: "gridH", kind: "int", default: 60, min: 8, max: 120, step: 1, description: "image モードのサンプリング縦解像度。" },
  ],
  createState(env: NodeEnv): PointCloudState {
    const pc = new PointCloud(env.renderer.getPixelRatio());
    pc.setProjection(env.renderer.domElement.height, env.camera.fov);
    const surface = new VisualSurface();
    surface.scene.add(pc.object3D);
    loadDefaultImage(pc);
    return { pc, surface };
  },
  disposeState(state: NodeState): void {
    (state as PointCloudState).surface.dispose();
  },
  evaluate(ctx) {
    const s = ctx.state as PointCloudState | undefined;
    const env = ctx.env;
    if (!s || !env) return {};
    // resize 追従: 毎フレーム projection を再計算（uniform 2 個の更新のみで軽量）。
    s.pc.setProjection(env.renderer.domElement.height, env.camera.fov);

    const keys: (keyof PointCloudCurated)[] = [
      "mode", "radius", "bassPulse", "polyhedron", "hueBase", "hueSpread", "saturation",
      "bassExpansion", "baseSize", "volumeSize", "twistStrength", "twistAxis",
      "latticeResolution", "latticeWaveAmplitude", "gridW", "gridH",
    ];
    const curated: Partial<PointCloudCurated> = {};
    for (const k of keys) {
      const v = ctx.param(k);
      if (v !== undefined) (curated as Record<string, unknown>)[k] = v;
    }
    const params = buildPointCloudParams(curated);

    const pose = ctx.input("pose") as PoseFrame | undefined;
    const joints = pose?.joints ?? makeEmptyJoints();
    const visibility = pose?.visibility ?? EMPTY_VIS;
    const center = pose?.center ?? EMPTY_CENTER;
    const audio = (ctx.input("audio") as AudioFeatures | undefined) ?? env.audio;

    s.pc.update(joints, visibility, center, audio, params, ctx.timeSec);
    const texture = s.surface.render(env.renderer, env.camera);
    return { texture };
  },
};
