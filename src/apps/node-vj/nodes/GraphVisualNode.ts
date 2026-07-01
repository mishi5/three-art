import type { NodeEnv, NodeState, NodeTypeDef } from "../graph/node-type";
import { GraphCanvasSurface } from "../graph/graph-canvas-surface";
import {
  computeGraphPoints,
  graphMaxSamples,
  pushSample,
  valueToY,
  type GraphSample,
} from "./graph-visual-logic";

// リングバッファ上限の算出前提（最大 windowSec × 想定 fps）。メモリ上限のためのキャップ。
const MAX_WINDOW_SEC = 30;
const ASSUMED_FPS = 60;
// #217: 描画サーフェスの長辺上限（px）。Canvas2D→CanvasTexture の毎フレームアップロード負荷を
// 抑えるため、出力/拡大表示の高解像度でもこのサイズにダウンスケールする（波形は中解像度で十分）。
const GRAPH_MAX_DIM = 1280;

interface GraphVisualState {
  surface: GraphCanvasSurface;
  buffer: GraphSample[];
  maxSamples: number;
}

/**
 * number 入力の時系列を折れ線グラフ（波形）で描画して texture 出力する visual sink（#217）。
 * 右端が最新・左へ流れるスクロール。yMin/yMax で縦、windowSec で横（時間窓）スケールを決める。
 */
export const GraphVisualNode: NodeTypeDef = {
  type: "GraphVisual",
  category: "visual",
  description:
    "number 入力の時系列を折れ線グラフ（波形）で描画して texture 出力する。右端が最新・左へ流れる。yMin/yMax で縦、windowSec で横スケール。",
  isSink: true,
  inputs: [{ id: "value", label: "value", type: "number", description: "グラフに描く数値の時系列。未接続時は 0。" }],
  outputs: [{ id: "texture", label: "tex", type: "texture", description: "波形を描いたテクスチャ。" }],
  params: [
    { id: "windowSec", label: "windowSec", kind: "number", default: 4, min: 0.25, max: 30, step: 0.25, description: "横スケール（時間窓・秒）。この幅ぶんの履歴を画面幅に表示する。" },
    { id: "yMin", label: "yMin", kind: "number", default: -1, min: -100, max: 100, step: 0.1, description: "縦スケール下端（画面下端に対応する値）。範囲外はクランプ。" },
    { id: "yMax", label: "yMax", kind: "number", default: 1, min: -100, max: 100, step: 0.1, description: "縦スケール上端（画面上端に対応する値）。範囲外はクランプ。" },
    { id: "lineWidth", label: "lineWidth", kind: "number", default: 2, min: 1, max: 8, step: 0.5, description: "折れ線の太さ（px）。" },
    { id: "r", label: "line R", kind: "number", default: 0.2, min: 0, max: 1, step: 0.01, description: "線色の R（0..1）。" },
    { id: "g", label: "line G", kind: "number", default: 1.0, min: 0, max: 1, step: 0.01, description: "線色の G（0..1）。" },
    { id: "b", label: "line B", kind: "number", default: 0.6, min: 0, max: 1, step: 0.01, description: "線色の B（0..1）。" },
    { id: "bgAlpha", label: "bgAlpha", kind: "number", default: 1, min: 0, max: 1, step: 0.01, description: "背景の不透明度（0=透明→下のレイヤが透ける / 1=不透明な黒）。" },
    { id: "zeroLine", label: "zeroLine", kind: "enum", default: "on", options: ["off", "on"], description: "中央基準線（値 0 の水平線）。on で表示。" },
  ],
  createState(_env: NodeEnv): GraphVisualState {
    return {
      surface: new GraphCanvasSurface(),
      buffer: [],
      maxSamples: graphMaxSamples(MAX_WINDOW_SEC, ASSUMED_FPS),
    };
  },
  disposeState(state: NodeState): void {
    (state as GraphVisualState).surface.dispose();
  },
  evaluate(ctx) {
    const s = ctx.state as GraphVisualState | undefined;
    const env = ctx.env;
    if (!s || !env) return {};

    // 入力値を timeSec 付きで push（未接続は 0）。
    const value = Number(ctx.input("value") ?? 0);
    pushSample(s.buffer, ctx.timeSec, value, s.maxSamples);

    // param 読み取り。
    const windowSec = clampNum(Number(ctx.param("windowSec") ?? 4), 0.25, 30);
    const yMin = Number(ctx.param("yMin") ?? -1);
    const yMax = Number(ctx.param("yMax") ?? 1);
    const lineWidth = clampNum(Number(ctx.param("lineWidth") ?? 2), 1, 8);
    const r = clamp01(Number(ctx.param("r") ?? 0.2));
    const g = clamp01(Number(ctx.param("g") ?? 1.0));
    const b = clamp01(Number(ctx.param("b") ?? 0.6));
    const bgAlpha = clamp01(Number(ctx.param("bgAlpha") ?? 1));
    const zeroLineOn = String(ctx.param("zeroLine") ?? "on") !== "off";

    // 描画解像度。Canvas2D→CanvasTexture を毎フレームアップロードするため、出力/拡大表示で
    // renderer が高解像度（フルスクリーン×dpr や 1920×1080）になるとアップロードコストが激増し
    // 実質フリーズする。波形は中解像度で十分なので、アスペクト比を保ったまま長辺を上限でキャップする。
    const rw = env.renderer.domElement.width || 2;
    const rh = env.renderer.domElement.height || 2;
    const scale = Math.min(1, GRAPH_MAX_DIM / Math.max(rw, rh));
    const w = Math.max(2, Math.round(rw * scale));
    const h = Math.max(2, Math.round(rh * scale));
    s.surface.resize(w, h);
    const cw = s.surface.width;
    const ch = s.surface.height;

    const g2d = s.surface.context2d;
    // 背景（bgAlpha に応じた黒。透明部分は下流で透過）。
    g2d.clearRect(0, 0, cw, ch);
    if (bgAlpha > 0) {
      g2d.fillStyle = `rgba(0,0,0,${bgAlpha})`;
      g2d.fillRect(0, 0, cw, ch);
    }

    // 中央基準線（値 0 の水平線）。
    if (zeroLineOn) {
      const zy = valueToY(0, yMin, yMax, ch);
      g2d.strokeStyle = "rgba(255,255,255,0.25)";
      g2d.lineWidth = 1;
      g2d.beginPath();
      g2d.moveTo(0, zy);
      g2d.lineTo(cw, zy);
      g2d.stroke();
    }

    // 折れ線（波形）。
    const pts = computeGraphPoints(s.buffer, {
      windowSec, yMin, yMax, timeSec: ctx.timeSec, width: cw, height: ch,
    });
    if (pts.length >= 2) {
      g2d.strokeStyle = `rgb(${to255(r)},${to255(g)},${to255(b)})`;
      g2d.lineWidth = lineWidth;
      g2d.lineJoin = "round";
      g2d.lineCap = "round";
      g2d.beginPath();
      g2d.moveTo(pts[0]!.x, pts[0]!.y);
      for (let i = 1; i < pts.length; i++) g2d.lineTo(pts[i]!.x, pts[i]!.y);
      g2d.stroke();
    }

    return { texture: s.surface.commit(env.renderer) };
  },
};

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
}

function clampNum(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : lo));
}

function to255(v: number): number {
  return Math.round(clamp01(v) * 255);
}
