// node-vj アプリのエントリポイント（#60 ノードエディタ最小実装）。
// 全画面の Canvas2D ノードエディタ + 隅の 3D プレビュー(PiP) + グラフランタイム。
// 既定グラフ: Number→Multiply←Number → RainVisual.baseSpeed（Number 編集で雨速度が変化）。
import { createDefaultRegistry } from "./nodes/registry";
import { addConnection, addNode, createGraph } from "./graph/graph-doc";
import { GraphRuntime } from "./graph/runtime";
import { NodeEditor } from "./editor/NodeEditor";
import { buildGraphIoBar } from "./editor/graph-io-bar";
import { GraphStore, localStorageAdapter } from "./graph/graph-store";
import { DEFAULT_AUDIO_FEATURES, type AudioFeatures } from "../../core/types";

const editorCanvas = document.getElementById("editor");
const previewCanvas = document.getElementById("preview");
if (!(editorCanvas instanceof HTMLCanvasElement)) throw new Error("editor canvas not found");
if (!(previewCanvas instanceof HTMLCanvasElement)) throw new Error("preview canvas not found");

const registry = createDefaultRegistry();
const graph = createGraph();

function defaults(type: string): Record<string, unknown> {
  const def = registry.require(type);
  return Object.fromEntries(def.params.map((p) => [p.id, p.default]));
}

// 既定グラフを構築
addNode(graph, { id: "speed", type: "Number", params: { value: 0.4 }, position: { x: 40, y: 90 } });
addNode(graph, { id: "scale", type: "Number", params: { value: 1.0 }, position: { x: 40, y: 240 } });
addNode(graph, { id: "mul", type: "Multiply", params: defaults("Multiply"), position: { x: 280, y: 150 } });
addNode(graph, { id: "rain", type: "RainVisual", params: defaults("RainVisual"), position: { x: 520, y: 110 } });
addConnection(graph, registry, { id: "c1", from: { node: "speed", port: "out" }, to: { node: "mul", port: "a" } });
addConnection(graph, registry, { id: "c2", from: { node: "scale", port: "out" }, to: { node: "mul", port: "b" } });
addConnection(graph, registry, { id: "c3", from: { node: "mul", port: "out" }, to: { node: "rain", port: "baseSpeed" } });

// プレビュー（PiP）ランタイム
const runtime = new GraphRuntime(previewCanvas, registry, graph);

// プレビュー拡大トグル: 小 PiP(320×180) ⇄ 大(ビューポート ~85%)。
// クリック（移動量小）で切替、ドラッグは OrbitControls の回転に使う。
const preview = previewCanvas;
let previewLarge = false;
function applyPreviewSize(): void {
  const w = previewLarge ? Math.round(window.innerWidth * 0.85) : 320;
  const h = previewLarge ? Math.round(window.innerHeight * 0.85) : 180;
  preview.style.width = w + "px";
  preview.style.height = h + "px";
  runtime.setSize(w, h);
}
applyPreviewSize();
{
  let downX = 0, downY = 0;
  preview.addEventListener("pointerdown", (e) => { downX = e.clientX; downY = e.clientY; });
  preview.addEventListener("pointerup", (e) => {
    if (Math.hypot(e.clientX - downX, e.clientY - downY) < 5) {
      previewLarge = !previewLarge;
      applyPreviewSize();
    }
  });
}
window.addEventListener("resize", applyPreviewSize);
// 入力ノード未実装のため合成 FFT で雨を落とす（audio 入力ノードは #61）。
const fft = new Float32Array(64).map((_, i) => 0.3 + 0.2 * Math.sin(i * 0.5));
const audio: AudioFeatures = { ...DEFAULT_AUDIO_FEATURES, fft };
runtime.setAudio(audio);
runtime.start();

// ノードエディタ（全画面）。出力ポートのライブ値は runtime の直近評価結果から引く。
const editor = new NodeEditor(
  editorCanvas, graph, registry,
  (id) => runtime.getOutputs(id),
  (id) => runtime.getPreviewCanvas(id),
);

// グラフ保存/読込バー（#65）。読込は replaceGraph で同一参照のまま反映される。
buildGraphIoBar(graph, registry, new GraphStore(localStorageAdapter()));

// 入力起動コントロール（mic/camera は user gesture 必須のためボタンから start）。
type Startable = { start?: () => Promise<void> };
type FileLoadable = { loadFile?: (f: File) => Promise<void> };

const bar = document.createElement("div");
bar.style.cssText =
  "position:fixed;left:8px;bottom:8px;display:flex;gap:6px;align-items:center;z-index:150;font:12px system-ui;";

const startBtn = document.createElement("button");
startBtn.textContent = "▶ 入力開始 (mic/camera)";
startBtn.style.cssText = "background:#1c1c22;color:#ddd;border:1px solid #444;border-radius:4px;padding:4px 8px;cursor:pointer;";
startBtn.addEventListener("click", () => {
  for (const n of graph.nodes) {
    const s = runtime.getState(n.id) as Startable | undefined;
    s?.start?.().catch((e) => console.warn(`[node-vj] start failed for ${n.id}:`, e));
  }
});
bar.appendChild(startBtn);

const fileLabel = document.createElement("label");
fileLabel.textContent = "音声ファイル: ";
fileLabel.style.color = "#aaa";
const fileInput = document.createElement("input");
fileInput.type = "file";
fileInput.accept = "audio/*";
fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  const audioNode = graph.nodes.find((n) => n.type === "AudioInput");
  if (!audioNode) { console.warn("[node-vj] AudioInput ノードを追加してください"); return; }
  const s = runtime.getState(audioNode.id) as FileLoadable | undefined;
  s?.loadFile?.(file).catch((e) => console.warn("[node-vj] loadFile failed:", e));
});
fileLabel.appendChild(fileInput);
bar.appendChild(fileLabel);
document.body.appendChild(bar);

(window as unknown as { nodeVj: unknown }).nodeVj = { graph, registry, runtime, editor };
console.log("[node-vj] editor + preview started");
