// node-vj アプリのエントリポイント（#60 ノードエディタ最小実装）。
// 全画面の Canvas2D ノードエディタ + 隅の 3D プレビュー(PiP) + グラフランタイム。
// 既定グラフ: Number→Multiply←Number → RainVisual.baseSpeed（Number 編集で雨速度が変化）。
import { createDefaultRegistry } from "./nodes/registry";
import { addConnection, addNode, createGraph } from "./graph/graph-doc";
import { GraphRuntime } from "./graph/runtime";
import { NodeEditor } from "./editor/NodeEditor";
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
runtime.setSize(320, 180);
// 入力ノード未実装のため合成 FFT で雨を落とす（audio 入力ノードは #61）。
const fft = new Float32Array(64).map((_, i) => 0.3 + 0.2 * Math.sin(i * 0.5));
const audio: AudioFeatures = { ...DEFAULT_AUDIO_FEATURES, fft };
runtime.setAudio(audio);
runtime.start();

// ノードエディタ（全画面）
const editor = new NodeEditor(editorCanvas, graph, registry);

(window as unknown as { nodeVj: unknown }).nodeVj = { graph, registry, runtime, editor };
console.log("[node-vj] editor + preview started");
