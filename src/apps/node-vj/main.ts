// node-vj アプリのエントリポイント（#60 ノードエディタ最小実装）。
// 全画面の Canvas2D ノードエディタ + 隅の 3D プレビュー(PiP) + グラフランタイム。
// 既定グラフ: Number→Multiply←Number → RainVisual.baseSpeed、RainVisual.tex → Screen。
// #98: 画面に出すには Screen への接続が必須（自動表示フォールバックは廃止）。
import { createDefaultRegistry } from "./nodes/registry";
import { addConnection, addNode, createGraph } from "./graph/graph-doc";
import { GraphRuntime } from "./graph/runtime";
import { NodeEditor } from "./editor/NodeEditor";
import { buildGraphIoBar } from "./editor/graph-io-bar";
import { GraphStore, localStorageAdapter } from "./graph/graph-store";
import { History } from "./graph/history";
import { previewSize } from "./preview-size";
import { OutputWindow, OUTPUT_RENDER_W, OUTPUT_RENDER_H } from "./output-window";
import type { PlaybackControl } from "./nodes/playback";
import { DEFAULT_AUDIO_FEATURES, type AudioFeatures } from "../../core/types";
import { AssetLibrary } from "./asset/asset-library";
import { opfsBinaryStore } from "./asset/binary-store";
import { indexedDbMetaStore } from "./asset/meta-store";
import { generateThumbnail } from "./asset/thumbnail";
import { buildAssetPanel } from "./asset/asset-panel";
import { assetDropTarget, nodeTypeForKind } from "./asset/asset-drop";
import { collectAssetRefs } from "./asset/asset-refs";

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
addNode(graph, { id: "screen", type: "Screen", params: {}, position: { x: 800, y: 110 } });
addConnection(graph, registry, { id: "c1", from: { node: "speed", port: "out" }, to: { node: "mul", port: "a" } });
addConnection(graph, registry, { id: "c2", from: { node: "scale", port: "out" }, to: { node: "mul", port: "b" } });
addConnection(graph, registry, { id: "c3", from: { node: "mul", port: "out" }, to: { node: "rain", port: "baseSpeed" } });
// #98: 画面表示は Screen 接続が必須。既定グラフで RainVisual → Screen を配線。
addConnection(graph, registry, { id: "c4", from: { node: "rain", port: "texture" }, to: { node: "screen", port: "texture" } });

// プレビュー（PiP）ランタイム
const runtime = new GraphRuntime(previewCanvas, registry, graph);

// #148: 出力ウィンドウ（プロジェクタ/セカンドディスプレイへのミラー）。
// applyPreviewSize が出力状態で描画解像度を切り替えるため、ここで生成しておく。
const output = new OutputWindow();

// プレビュー拡大トグル: 小 PiP(320×180) ⇄ 全画面（#136）。
// クリック（移動量小）で切替、ドラッグは OrbitControls の回転に使う。Esc で全画面解除。
const preview = previewCanvas;
let previewLarge = false;
function applyPreviewSize(): void {
  const { w, h } = previewSize(previewLarge, window.innerWidth, window.innerHeight);
  preview.style.width = w + "px";
  preview.style.height = h + "px";
  if (previewLarge) {
    // 全画面: 画面全体を占有して最前面に。
    Object.assign(preview.style, { left: "0", top: "0", right: "auto", bottom: "auto", border: "none", zIndex: "200" });
  } else {
    // 小窓: 右下 PiP に戻す（node-vj.html の既定と同じ）。
    Object.assign(preview.style, { left: "auto", top: "auto", right: "12px", bottom: "56px", border: "1px solid rgba(255,255,255,0.25)", zIndex: "120" });
  }
  // #148: 出力ウィンドウ表示中は PiP の見た目サイズに依らず高解像度で描き、出力を鮮明にする
  //（PiP は CSS で縮小表示＝同じ映像の縮小ビュー）。通常は表示サイズ×dpr で描く。
  if (output.isOpen()) {
    runtime.setRenderSize(OUTPUT_RENDER_W, OUTPUT_RENDER_H, 1);
  } else {
    runtime.setRenderSize(w, h, Math.min(window.devicePixelRatio, 2));
  }
}
applyPreviewSize();
function setPreviewLarge(large: boolean): void {
  if (previewLarge === large) return;
  previewLarge = large;
  applyPreviewSize();
}
{
  let downX = 0, downY = 0;
  preview.addEventListener("pointerdown", (e) => { downX = e.clientX; downY = e.clientY; });
  preview.addEventListener("pointerup", (e) => {
    if (Math.hypot(e.clientX - downX, e.clientY - downY) < 5) setPreviewLarge(!previewLarge);
  });
}
window.addEventListener("keydown", (e) => { if (e.key === "Escape") setPreviewLarge(false); });
window.addEventListener("resize", applyPreviewSize);
// 入力ノード未実装のため合成 FFT で雨を落とす（audio 入力ノードは #61）。
const fft = new Float32Array(64).map((_, i) => 0.3 + 0.2 * Math.sin(i * 0.5));
const audio: AudioFeatures = { ...DEFAULT_AUDIO_FEATURES, fft };
runtime.setAudio(audio);
runtime.start();

// #154: アセットライブラリ（OPFS バイナリ + IndexedDB メタ）。サムネは DOM で生成。
const library = new AssetLibrary({
  binary: opfsBinaryStore(),
  meta: indexedDbMetaStore(),
  makeThumbnail: generateThumbnail,
});

/** #154: ファイルをライブラリへ取り込み、得た assetId をノード params に記録する。 */
function recordAsset(nodeId: string, file: File): void {
  library.add(file).then((m) => {
    if (!m) return;
    const n = graph.nodes.find((x) => x.id === nodeId);
    if (n) n.params.assetId = m.id;
  }).catch((e) => console.warn(`[node-vj] library.add failed for ${nodeId}:`, e));
}

// ノードエディタ（全画面）。出力ポートのライブ値は runtime の直近評価結果から引く。
const history = new History();
type FileLoadable = { loadFile?: (f: File) => Promise<void> };
type Named = { fileName?: string | null };
const editor = new NodeEditor(
  editorCanvas, graph, registry, history,
  (id) => runtime.getOutputs(id),
  (id) => runtime.getPreviewSource(id),
  // #99: ファイル選択をそのノードのランタイムへ読み込ませる。
  (id, file) => {
    runtime.resumeAudio(); // #128: ファイル読込（user gesture）で共有 AudioContext を起こす
    const s = runtime.getState(id) as FileLoadable | undefined;
    s?.loadFile?.(file).catch((e) => console.warn(`[node-vj] loadFile failed for ${id}:`, e));
    recordAsset(id, file); // #154: 直接選択もライブラリに取り込み assetId を記録
  },
  (id) => (runtime.getState(id) as Named | undefined)?.fileName ?? null,
  // #99: ノードごとの再生コントロール（PlaybackControl を持つノードのみ機能）。
  {
    get: (id) => {
      const s = runtime.getState(id) as Partial<PlaybackControl> | undefined;
      if (!s || typeof s.getDuration !== "function") return null;
      return { playing: s.isPlaying!(), current: s.getCurrentTime!(), duration: s.getDuration() };
    },
    toggle: (id) => (runtime.getState(id) as Partial<PlaybackControl> | undefined)?.togglePlay?.(),
    seek: (id, t) => (runtime.getState(id) as Partial<PlaybackControl> | undefined)?.seek?.(t),
  },
);

// #154: canvas へドロップされたアセットを読み込む。
// ファイル入力ノード本体に重なれば割当、空白なら種別に応じてノードを生成して割当。
function loadAssetIntoNode(nodeId: string, assetId: string, file: File): void {
  const s = runtime.getState(nodeId) as FileLoadable | undefined;
  void s?.loadFile?.(file).catch((e) => console.warn(`[node-vj] loadFile failed for ${nodeId}:`, e));
  const n = graph.nodes.find((x2) => x2.id === nodeId);
  if (n) n.params.assetId = assetId; // 保存対象に記録
}
editor.onDropAsset = (assetId, x, y) => {
  runtime.resumeAudio(); // #128: 読込（user gesture）で共有 AudioContext を起こす
  Promise.all([library.getFile(assetId), library.get(assetId)]).then(([file, meta]) => {
    if (!file || !meta) return;
    let nodeId = assetDropTarget(graph, registry, x, y);
    if (!nodeId) {
      // 空白ドロップ: 種別に応じたファイル入力ノードを drop 位置に生成する。
      nodeId = editor.addNodeOfType(nodeTypeForKind(meta.kind), { x, y });
      runtime.ensureStates(); // 生成直後に loadFile したいので state を即時生成
    }
    loadAssetIntoNode(nodeId, assetId, file);
  }).catch((e) => console.warn(`[node-vj] drop asset failed ${assetId}:`, e));
};

/** #154: グラフ読込後、params.assetId を持つノードへライブラリからファイルを復元する。 */
async function restoreAssets(): Promise<void> {
  for (const ref of collectAssetRefs(graph)) {
    const file = await library.getFile(ref.assetId);
    if (!file) { console.warn(`[node-vj] asset not found: ${ref.assetId}`); continue; }
    const s = runtime.getState(ref.nodeId) as FileLoadable | undefined;
    await s?.loadFile?.(file).catch((e) => console.warn(`[node-vj] restore failed ${ref.nodeId}:`, e));
  }
}

// #154: アセットパネル（左サイド・開閉トグル）を表示する。
buildAssetPanel(library);

// グラフ保存/読込バー（#65）。読込は replaceGraph で同一参照のまま反映される。
// #154: 読込完了後に restoreAssets でアセットを自動復元する。
buildGraphIoBar(graph, registry, new GraphStore(localStorageAdapter()), history, () => { void restoreAssets(); });

// 入力起動コントロール（mic/camera/display は user gesture 必須のためボタンから start）。
// #99: ファイル選択はノード上の「ファイル行」クリックに移行（共有ファイル input は撤去）。
type Startable = { start?: () => Promise<void> };

const bar = document.createElement("div");
bar.style.cssText =
  "position:fixed;left:8px;bottom:8px;display:flex;gap:6px;align-items:center;z-index:150;font:12px system-ui;";

const startBtn = document.createElement("button");
startBtn.textContent = "▶ 入力開始 (mic/camera)";
startBtn.style.cssText = "background:#1c1c22;color:#ddd;border:1px solid #444;border-radius:4px;padding:4px 8px;cursor:pointer;";
startBtn.addEventListener("click", () => {
  runtime.resumeAudio(); // #128: user gesture で共有 AudioContext を起こす
  for (const n of graph.nodes) {
    const s = runtime.getState(n.id) as Startable | undefined;
    s?.start?.().catch((e) => console.warn(`[node-vj] start failed for ${n.id}:`, e));
  }
});
bar.appendChild(startBtn);

// #148: Screen 出力を別ウィンドウ（プロジェクタ/セカンドディスプレイ）へミラーするトグル。
const outBtn = document.createElement("button");
outBtn.style.cssText = "background:#1c1c22;color:#ddd;border:1px solid #444;border-radius:4px;padding:4px 8px;cursor:pointer;";
function syncOutBtn(): void {
  outBtn.textContent = output.isOpen() ? "🖥 出力ウィンドウを閉じる" : "🖥 出力ウィンドウ";
  // #148: 出力ウィンドウ表示中は本体が隠れても描画を回し続ける（全画面で固まらないように）。
  runtime.setKeepAliveWhileHidden(output.isOpen());
  applyPreviewSize();   // 出力状態に応じて描画解像度（高解像度⇄表示サイズ）を切り替える
}
output.onClose = syncOutBtn;
outBtn.addEventListener("click", () => {
  if (output.isOpen()) output.close();
  else output.open(previewCanvas);   // previewCanvas = renderer の出力 canvas
  syncOutBtn();
});
syncOutBtn();
bar.appendChild(outBtn);

document.body.appendChild(bar);

(window as unknown as { nodeVj: unknown }).nodeVj = { graph, registry, runtime, editor };
console.log("[node-vj] editor + preview started");
