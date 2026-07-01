// node-vj アプリのエントリポイント（#60 ノードエディタ最小実装）。
// 全画面の Canvas2D ノードエディタ + 隅の 3D プレビュー(PiP) + グラフランタイム。
// 既定グラフ: Number→Multiply←Number → RainVisual.baseSpeed、RainVisual.tex → Screen。
// #98: 画面に出すには Screen への接続が必須（自動表示フォールバックは廃止）。
import { createDefaultRegistry } from "./nodes/registry";
import { addConnection, addNode, createGraph, replaceGraph } from "./graph/graph-doc";
import { GraphRuntime } from "./graph/runtime";
import { NodeEditor } from "./editor/NodeEditor";
import { openPadOverlay } from "./editor/pad-overlay";
import { buildGraphIoBar } from "./editor/graph-io-bar";
import { GraphStore, localStorageAdapter } from "./graph/graph-store";
import { History } from "./graph/history";
import { previewSize } from "./preview-size";
import { OutputWindow, OUTPUT_RENDER_W, OUTPUT_RENDER_H } from "./output-window";
import { Recorder, pickRecorderMimeType, recordingFileName } from "./recorder";
import { audioOutputOptions, type AudioOutputOption } from "./scene/output-audio";
import { stopIfPlaying, type PlaybackControl } from "./nodes/playback";
import { DEFAULT_AUDIO_FEATURES, type AudioFeatures } from "../../core/types";
import { AssetLibrary } from "./asset/asset-library";
import { opfsBinaryStore } from "./asset/binary-store";
import { indexedDbMetaStore } from "./asset/meta-store";
import { generateThumbnail } from "./asset/thumbnail";
import { assetPanelDef } from "./asset/asset-panel";
import { assetDropTarget, nodeTypeForKind } from "./asset/asset-drop";
import { collectAssetRefs } from "./asset/asset-refs";
import { SceneStore } from "./scene/scene-store";
import { SceneManager, singleSceneSet } from "./scene/scene-manager";
import { sanitizeSceneSet } from "./scene/scene-sanitize";
import { serializeProject, deserializeProject, projectFileName } from "./scene/project-file";
import { wouldCreateSceneCycle } from "./scene/scene-refs";
import { scenePanelDef, type ScenePanelActions } from "./scene/scene-panel";
import { buildSideDock } from "./editor/side-dock";
import { NodeClipboard } from "./editor/node-clipboard";
import { clipboardPanelDef } from "./editor/clipboard-panel";

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
// #179: 録画器。applyPreviewSize が録画中も高解像度で描くため先に生成しておく。
const recorder = new Recorder();
// #179: 録画ビットレート（1080p を鮮明に保つ。既定の自動値は低すぎることがある）。
const RECORD_VIDEO_BITRATE = 16_000_000;

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
  // #148/#179: 出力ウィンドウ表示中・録画中は PiP の見た目サイズに依らず高解像度で描き、
  // 出力/録画を鮮明にする（PiP は CSS で縮小表示＝同じ映像の縮小ビュー）。通常は表示サイズ×dpr。
  if (output.isOpen() || recorder.recording) {
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

/** #205: パッドへ割り当てたファイルをライブラリへ取り込み、params.padAssets[slot] に assetId を記録する。 */
function recordPadAsset(nodeId: string, slot: number, file: File): void {
  library.add(file).then((m) => {
    if (!m) return;
    const n = graph.nodes.find((x) => x.id === nodeId);
    if (!n) return;
    // 共有 default 配列を破壊しないよう必ず slice して自分専用の配列にしてから書き込む。
    const prev = (n.params as Record<string, unknown>).padAssets;
    const arr = Array.isArray(prev) ? prev.slice() : [];
    arr[slot] = m.id;
    (n.params as Record<string, unknown>).padAssets = arr;
  }).catch((e) => console.warn(`[node-vj] library.add (pad) failed for ${nodeId}:`, e));
}

/** #205: パッドへの音声割当（user gesture 内でファイル選択ダイアログを開く）。 */
function openPadFileDialog(nodeId: string, slot: number): void {
  // #205: 再割当を始めたら、そのパッドで鳴っている音を止める（古い音源を残さない）。
  (runtime.getState(nodeId) as PadLoadable | undefined)?.stopPad?.(slot);
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "audio/*";
  input.style.display = "none";
  document.body.appendChild(input);
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (file) {
      runtime.resumeAudio();
      const s = runtime.getState(nodeId) as PadLoadable | undefined;
      void s?.loadPadFile?.(slot, file).catch((e) => console.warn(`[node-vj] loadPadFile failed ${nodeId}[${slot}]:`, e));
      recordPadAsset(nodeId, slot, file);
    }
    input.remove();
  });
  input.addEventListener("cancel", () => input.remove());
  input.click();
}

// ノードエディタ（全画面）。出力ポートのライブ値は runtime の直近評価結果から引く。
const history = new History();
type FileLoadable = { loadFile?: (f: File) => Promise<void> };
type Named = { fileName?: string | null };
// #205: MidiPad ランタイムの duck-type（パッド割当/発音/状態参照）。
type PadLoadable = {
  loadPadFile?: (index: number, file: File) => Promise<void>;
  playPad?: (index: number) => void;
  hasPad?: (index: number) => boolean;
  padLabel?: (index: number) => string | null;
  stopAll?: () => void;
  stopPad?: (index: number) => void;
  clearPad?: (index: number) => void;
};
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
  // #152: SceneInput のシーン選択（循環候補は除外したドロップダウン）。
  {
    options: () => {
      const activeId = sceneManager.activeId();
      const scenes = sceneManager.list();
      return scenes
        .filter((s) => s.id !== activeId)
        .filter((s) => !wouldCreateSceneCycle(scenes, registry, activeId, s.id))
        .map((s) => ({ id: s.id, name: s.name }));
    },
    current: (nodeId) => {
      const n = graph.nodes.find((x) => x.id === nodeId);
      const sid = (n?.params as Record<string, unknown> | undefined)?.sceneId;
      if (typeof sid !== "string" || !sid) return null;
      return sceneManager.list().find((s) => s.id === sid)?.name ?? "(不明なシーン)";
    },
    choose: (nodeId, sceneId) => {
      const n = graph.nodes.find((x) => x.id === nodeId);
      if (n) { history.record(graph); n.params.sceneId = sceneId; }
    },
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
// #206: ノードのアプリ内クリップボード（Cmd+C コピー / Cmd+V 貼付 / パネルからのドロップ貼付）。
const clipboard = new NodeClipboard();
editor.clipboard = clipboard;
// #205: MidiPad のパッド操作配線（発音・割当・状態参照）。
editor.onHitPad = (id, idx) => {
  runtime.resumeAudio(); // user gesture で共有 AudioContext を起こす
  (runtime.getState(id) as PadLoadable | undefined)?.playPad?.(idx);
};
editor.onAssignPad = (id, idx) => {
  runtime.resumeAudio();
  openPadFileDialog(id, idx); // pointerdown の user gesture 内でダイアログを開く
};
editor.padCellInfo = (id, idx) => {
  const s = runtime.getState(id) as PadLoadable | undefined;
  if (!s || typeof s.hasPad !== "function") return undefined;
  return { filled: s.hasPad(idx), label: s.padLabel?.(idx) ?? null };
};
// #205: パッドへの（再）割当を 1 か所に集約（ファイル選択ダイアログ→loadPadFile＋padAssets 上書き）。
function assignPad(nodeId: string, slot: number): void {
  runtime.resumeAudio();
  openPadFileDialog(nodeId, slot);
}

/** #205: パッドの割当を解除する（鳴っている音を止め・buffer を空に・padAssets[slot] を消す）。 */
function unassignPad(nodeId: string, slot: number): void {
  (runtime.getState(nodeId) as PadLoadable | undefined)?.clearPad?.(slot);
  const n = graph.nodes.find((x) => x.id === nodeId);
  const prev = n ? (n.params as Record<string, unknown>).padAssets : undefined;
  if (n && Array.isArray(prev)) {
    const arr = prev.slice(); // 共有 default を壊さないよう slice
    arr[slot] = ""; // 空文字＝未割当（collectAssetRefs は非空のみ拾う）
    (n.params as Record<string, unknown>).padAssets = arr;
  }
}
// #205: 拡大ボタン → 画面全体のパッドオーバーレイを開く（対象ノードの padGrid 寸法で）。
editor.onExpandPad = (id) => {
  runtime.resumeAudio();
  const n = graph.nodes.find((x) => x.id === id);
  const def = n ? registry.get(n.type) : undefined;
  const grid = def?.padGrid ?? { rows: 4, cols: 4 };
  openPadOverlay(id, {
    rows: grid.rows, cols: grid.cols,
    play: (nodeId, idx) => { runtime.resumeAudio(); (runtime.getState(nodeId) as PadLoadable | undefined)?.playPad?.(idx); },
    stop: (nodeId) => (runtime.getState(nodeId) as PadLoadable | undefined)?.stopAll?.(),
    stopVoice: (nodeId, idx) => (runtime.getState(nodeId) as PadLoadable | undefined)?.stopPad?.(idx),
    assign: (nodeId, idx) => assignPad(nodeId, idx),
    unassign: (nodeId, idx) => unassignPad(nodeId, idx),
    info: (nodeId, idx) => {
      const s = runtime.getState(nodeId) as PadLoadable | undefined;
      if (!s || typeof s.hasPad !== "function") return undefined;
      return { filled: s.hasPad(idx), label: s.padLabel?.(idx) ?? null };
    },
  });
};
// #205: 全停止ボタン → 発音中の音をすべて止める。
editor.onStopPad = (id) => (runtime.getState(id) as PadLoadable | undefined)?.stopAll?.();
// #205: 音入りパッドの Alt+クリック → 割当解除（空に戻す）。
editor.onUnassignPad = (id, idx) => unassignPad(id, idx);
// #205: 音入りパッドの Cmd/Ctrl+クリック → そのパッドの発音中の音だけ止める（個別停止）。
editor.onStopPadVoice = (id, idx) => (runtime.getState(id) as PadLoadable | undefined)?.stopPad?.(idx);
// #205: アセットをパッド上にドロップ → そのパッドへ割当（再割当も上書き）。
editor.onDropAssetToPad = (id, idx, assetId) => {
  runtime.resumeAudio();
  library.getFile(assetId).then((file) => {
    if (!file) return;
    const s = runtime.getState(id) as PadLoadable | undefined;
    s?.stopPad?.(idx); // 再割当時は古い音を止める
    void s?.loadPadFile?.(idx, file).catch((e) => console.warn(`[node-vj] loadPadFile (drop) failed ${id}[${idx}]:`, e));
    // padAssets[idx] を上書き（共有 default を壊さないよう slice してから書く・recordPadAsset と同様）。
    const n = graph.nodes.find((x) => x.id === id);
    if (n) {
      const prev = (n.params as Record<string, unknown>).padAssets;
      const arr = Array.isArray(prev) ? prev.slice() : [];
      arr[idx] = assetId;
      (n.params as Record<string, unknown>).padAssets = arr;
    }
  }).catch((e) => console.warn(`[node-vj] drop asset to pad failed ${assetId}:`, e));
};
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
    // #205: slot 付き参照（MidiPad のパッド）は loadPadFile で復元する。
    if (ref.slot !== undefined) {
      const pad = runtime.getState(ref.nodeId) as PadLoadable | undefined;
      if (pad?.hasPad?.(ref.slot)) continue; // 既に割当済みは再読込しない
      const file = await library.getFile(ref.assetId);
      if (!file) { console.warn(`[node-vj] asset not found: ${ref.assetId}`); continue; }
      await pad?.loadPadFile?.(ref.slot, file).catch((e) => console.warn(`[node-vj] pad restore failed ${ref.nodeId}[${ref.slot}]:`, e));
      continue;
    }
    // #174: state 移譲で既に読込済み（再生継続中）のノードは再読込しない（loadFile は先頭から再生し直すため）。
    const cur = runtime.getState(ref.nodeId) as (FileLoadable & Named) | undefined;
    if (cur?.fileName) continue;
    const file = await library.getFile(ref.assetId);
    if (!file) { console.warn(`[node-vj] asset not found: ${ref.assetId}`); continue; }
    await cur?.loadFile?.(file).catch((e) => console.warn(`[node-vj] restore failed ${ref.nodeId}:`, e));
    // #221: 復元による新規読込は auto-play させない（loadFile は先頭から自動再生するため停止する）。
    //       state 移譲で既読込のノードは上の cur.fileName で continue 済み＝ここには来ないので、
    //       切替前の再生/停止状態は維持される。
    stopIfPlaying(cur);
  }
}

// #151: シーン管理。SceneStore から復元、無ければ既定グラフを唯一のシーンとして初期化。
const sceneStore = new SceneStore(localStorage);
const genSceneId = (): string => `scene-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
// #213 復元した SceneSet は未知ノード型を含みうる（旧ビルド/他環境の localStorage）。
// deserializeGraph 相当のサニタイズを通し、未知ノード/不正接続を除去してから採用する。
// これを怠ると評価器の未知 type 参照で tick ループごとクラッシュし、localStorage 汚染で
// 復帰不能になる。全滅時は null が返るので既定シーンへフォールバックする。
const rawSavedSceneSet = sceneStore.load();
let savedSceneSet = rawSavedSceneSet;
if (rawSavedSceneSet) {
  const sanitized = sanitizeSceneSet(rawSavedSceneSet, registry);
  savedSceneSet = sanitized.set;
  if (sanitized.warnings.length > 0) {
    console.warn("[node-vj] 復元シーンをサニタイズしました:", sanitized.warnings);
  }
}
const sceneManager = new SceneManager(
  { store: sceneStore, genId: genSceneId },
  savedSceneSet ?? singleSceneSet(structuredClone(graph), genSceneId(), "Scene 1"),
);
if (savedSceneSet) {
  // 復元: アクティブシーンの内容を共有グラフへ反映し、アセットを復元。
  const act = sceneManager.active();
  replaceGraph(graph, structuredClone(act.graph));
  history.useScene(act.id);
  // #220: restoreAssets は runtime.getState(nodeId) 経由で loadFile を呼ぶため、先に state を生成する。
  //       これが無いと初期表示でアセットが読み込まれず、シーン切替で戻って初めて読み込まれていた。
  //       reflectActiveScene と手順を揃える。
  runtime.ensureStates();
  void restoreAssets();
} else {
  history.useScene(sceneManager.activeId());
}
sceneManager.persist(); // 初回（未保存）も含め現在の集合を localStorage に確定させる

// #152: SceneInput の参照解決。アクティブ以外は sceneManager の GraphDoc を、アクティブは編集中の共有 graph を使う。
function wireSceneProvider(): void {
  runtime.setSceneProvider(
    (id) => sceneManager.list().find((s) => s.id === id)?.graph ?? null,
    sceneManager.activeId(),
  );
}
wireSceneProvider();
// #174: 出力シーン id を runtime に同期する（編集と独立に出力するシーン）。
function syncOutputScene(): void {
  runtime.setOutputSceneId(sceneManager.outputId());
}
syncOutputScene();

// #172: 参照先シーンの音声/動画入力を assetId 経由で復元し、解析・再生を走らせる（音声駆動の映像も動く）。
runtime.setSceneAssetRestorer((node, state) => {
  const assetId = (node.params as Record<string, unknown>).assetId;
  if (typeof assetId !== "string" || !assetId) return;
  void library.getFile(assetId).then((f) => {
    if (f) void (state as FileLoadable).loadFile?.(f)?.catch((e) => console.warn(`[node-vj] scene asset restore failed ${node.id}:`, e));
  }).catch((e) => console.warn(`[node-vj] scene getFile failed ${assetId}:`, e));
});
runtime.resumeAudio(); // 参照先音声の start のため AudioContext を起こす（後続の操作でも resume される）

/** 編集中の共有グラフを現アクティブシーンへ書き戻す（切替/保存前に呼ぶ）。 */
function snapshotActiveScene(): void {
  sceneManager.updateActiveGraph(graph);
}

/**
 * 新アクティブシーンの内容を共有グラフへ反映し、履歴トラック切替・state 再同期・アセット復元する。
 * アセット復元（restoreAssets）の Promise を返すので、読込直後に再生停止する等の後処理を連鎖できる。
 */
function reflectActiveScene(): Promise<void> {
  const act = sceneManager.active();
  // #174: 切替前に state を移譲（破棄しない）。pin 中に編集シーンを切り替えても、
  // 出力/参照先として再生継続中の動画/音声がシーク位置を保つ（replaceGraph より前に呼ぶ）。
  runtime.migrateActiveStates(act.id);
  replaceGraph(graph, structuredClone(act.graph));
  history.useScene(act.id);
  runtime.resumeAudio();   // user gesture 由来の切替で共有 AudioContext を起こす
  runtime.ensureStates();  // 移譲後の state を新グラフへ整合（不足ノードのみ生成・余剰のみ破棄）
  wireSceneProvider();     // #152: 新しいアクティブシーン id を runtime に反映
  return restoreAssets();  // 新シーンの assetId をライブラリから復元（読込済みはスキップ）
}

/** #201: 現アクティブグラフの Video/AudioFileInput を停止状態にする（プロジェクト読込直後など）。 */
function pauseActivePlayback(): void {
  for (const node of graph.nodes) {
    stopIfPlaying(runtime.getState(node.id)); // 再生中のみ停止（loadFile は自動再生のため）
  }
}

const sceneActions: ScenePanelActions = {
  list: () => sceneManager.list(),
  activeId: () => sceneManager.activeId(),
  switchTo: (id) => {
    if (id === sceneManager.activeId()) return;
    snapshotActiveScene();       // 現シーンの編集を保存
    sceneManager.setActive(id);
    void reflectActiveScene();
  },
  add: () => {
    snapshotActiveScene();
    sceneManager.add();          // 空シーンを作り active に
    void reflectActiveScene();
  },
  duplicate: (id) => {
    snapshotActiveScene();
    sceneManager.duplicate(id);  // 複製を active に
    void reflectActiveScene();
  },
  remove: (id) => {
    const wasActive = id === sceneManager.activeId();
    history.removeScene(id);
    sceneManager.remove(id);     // 最後の1つは消えない・active が変わりうる
    if (wasActive && sceneManager.activeId() !== id) void reflectActiveScene();
  },
  rename: (id, name) => sceneManager.rename(id, name),
  onChange: (cb) => sceneManager.onChange(cb),
  // #174: 出力シーンのピン留め/解除。runtime にも反映する。
  outputId: () => sceneManager.outputId(),
  setOutput: (id) => { sceneManager.setOutput(id); syncOutputScene(); },
};
// #151: VSCode 風サイドドック（最左アイコン列で アセット/シーン を切替）。
buildSideDock([assetPanelDef(library), scenePanelDef(sceneActions), clipboardPanelDef(clipboard)]);

// 自動永続化: 編集の取りこぼし防止に定期 + ページ離脱時にアクティブシーンへ書き戻して保存。
setInterval(() => snapshotActiveScene(), 5000);
window.addEventListener("beforeunload", () => snapshotActiveScene());

// グラフ保存/読込バー（#65）。読込は replaceGraph で同一参照のまま反映される。
// #154: 読込完了後に restoreAssets でアセットを自動復元する。
// #201: プロジェクト（全シーン状態）保存/読込フックを併設する。
buildGraphIoBar(
  graph, registry, new GraphStore(localStorageAdapter()), history,
  () => { void restoreAssets(); },
  {
    // 保存: 編集中グラフをアクティブシーンへ書き戻してから全シーンを YAML 化。
    serialize: () => { snapshotActiveScene(); return serializeProject(sceneManager.toSceneSet()); },
    // 読込: 現在の状態を破棄して復元。失敗時は throw（UI が toast 表示）。
    apply: (text) => {
      const { project, warnings } = deserializeProject(text, registry);
      history.clear();                 // 旧シーンの履歴トラックを捨てる（読込は全置換）
      sceneManager.replaceAll(project); // onChange でシーンパネル再描画
      // 共有 graph 反映・state 再同期・restoreAssets。復元完了後に Video/Audio を停止状態にする
      // （loadFile は自動再生するため、読込直後は止めておく）。
      void reflectActiveScene().catch(() => { /* 復元失敗時も停止は試みる */ }).then(() => pauseActivePlayback());
      syncOutputScene();               // #174 出力シーン id を runtime へ反映
      return warnings;
    },
    downloadName: () => projectFileName(new Date()),
  },
);

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
  // #174: 出力ウィンドウ表示中だけ出力 canvas を更新する。
  runtime.setOutputActive(output.isOpen());
  applyPreviewSize();   // 出力状態に応じて描画解像度（高解像度⇄表示サイズ）を切り替える
}
output.onClose = syncOutBtn;
outBtn.addEventListener("click", () => {
  if (output.isOpen()) output.close();
  // #174: 出力 canvas（出力シーンを描く 2D canvas）をミラーする（編集と分離可能）。
  else output.open(runtime.getOutputCanvas());
  syncOutBtn();
});
syncOutBtn();
bar.appendChild(outBtn);

// #179: 出力（出力 canvas = 出力シーンに追従）をビデオ録画して保存する（recorder は上部で生成済み）。
const recBtn = document.createElement("button");
recBtn.style.cssText = "background:#1c1c22;color:#ddd;border:1px solid #444;border-radius:4px;padding:4px 8px;cursor:pointer;";
function syncRecBtn(): void {
  recBtn.textContent = recorder.recording ? "■ 停止（録画中）" : "● 録画";
  recBtn.style.color = recorder.recording ? "#ff6b6b" : "#ddd";
  recBtn.style.borderColor = recorder.recording ? "#ff6b6b" : "#444";
}
/** 録画した Blob を webm としてダウンロードする。 */
function downloadRecording(blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = recordingFileName(new Date());
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
recBtn.addEventListener("click", () => {
  if (recorder.recording) {
    void recorder.stop().then((blob) => {
      runtime.setRecording(false);
      applyPreviewSize();          // #179: 録画終了で描画解像度を通常へ戻す
      if (blob.size > 0) downloadRecording(blob);
      syncRecBtn();
    });
  } else {
    runtime.resumeAudio();        // #128: user gesture で共有 AudioContext を起こす（音声録画に必要）
    runtime.setRecording(true);   // 録画中は出力 canvas を更新し続ける
    // #179: 録画は高解像度（OUTPUT_RENDER_W×H）で描く。出力ウィンドウ非表示でも鮮明に録る。
    runtime.setRenderSize(OUTPUT_RENDER_W, OUTPUT_RENDER_H, 1);
    const mime = pickRecorderMimeType((m) => MediaRecorder.isTypeSupported(m));
    recorder.start(runtime.getRecordingStream(30, true), mime, RECORD_VIDEO_BITRATE);  // 映像＋音声
    syncRecBtn();
  }
});
syncRecBtn();
bar.appendChild(recBtn);

// #198: 出力シーン（ピン中）の音声を別オーディオ出力デバイスへ発音する（モニター/プログラム分離）。
// 隠し <audio> に出力音声 stream を流し、ドロップダウンで選んだデバイスへ setSinkId で出す。
// ポリシー: ピン時のみ分離（追従中は編集シーンの音が既定デバイスで鳴っているため出さない）。
type SinkAudio = HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
// 隠し <audio> を 2 本（出力音声＝プログラム / モニター音声＝編集音）置き、各々別デバイスへ setSinkId で発音する。
const outAudioEl = document.createElement("audio") as SinkAudio;
outAudioEl.style.display = "none";
document.body.appendChild(outAudioEl);
const monAudioEl = document.createElement("audio") as SinkAudio;
monAudioEl.style.display = "none";
document.body.appendChild(monAudioEl);

const audioSelCss =
  "background:#1c1c22;color:#ddd;border:1px solid #444;border-radius:4px;padding:4px 6px;cursor:pointer;max-width:180px;";
const outAudioSel = document.createElement("select");
outAudioSel.title = "出力シーン（ピン中）の音声を発音するデバイス";
outAudioSel.style.cssText = audioSelCss;
const monAudioSel = document.createElement("select");
monAudioSel.title = "編集中シーンの音声（モニター）を発音するデバイス";
monAudioSel.style.cssText = audioSelCss;

/** select に audiooutput 一覧を流し込む（先頭は分離なし・選択は維持）。 */
function fillDeviceSelect(sel: HTMLSelectElement, opts: AudioOutputOption[], noneLabel: string, prefix: string): void {
  const prev = sel.value;
  sel.replaceChildren();
  const none = document.createElement("option");
  none.value = "";
  none.textContent = noneLabel;
  sel.appendChild(none);
  for (const o of opts) {
    const el = document.createElement("option");
    el.value = o.deviceId;
    el.textContent = `${prefix} ${o.label}`;
    sel.appendChild(el);
  }
  // 以前の選択がまだ存在すれば維持。
  if (prev && opts.some((o) => o.deviceId === prev)) sel.value = prev;
}

/** enumerateDevices から audiooutput 一覧で両ドロップダウンを再構築する（選択は維持）。 */
async function refreshAudioOutputs(): Promise<void> {
  let devices: MediaDeviceInfo[] = [];
  try { devices = await navigator.mediaDevices.enumerateDevices(); } catch { /* 取得不可 */ }
  const opts = audioOutputOptions(devices);
  fillDeviceSelect(outAudioSel, opts, "🔈 出力音声: 分離しない", "🔈");
  fillDeviceSelect(monAudioSel, opts, "🎧 モニター音声: 既定デバイス", "🎧");
}

// #198: 出力シーン（ピン中）の音声を別オーディオ出力デバイスへ発音する（プログラム側）。
outAudioSel.addEventListener("change", () => {
  runtime.resumeAudio(); // user gesture で共有 AudioContext を起こす
  const id = outAudioSel.value;
  if (!id) {
    // 分離しない: 隠し <audio> を停止（runtime の分岐接続は無害なまま残す）。
    outAudioEl.pause();
    return;
  }
  // 出力音声 stream を <audio> に流し、選択デバイスへ発音する。
  if (outAudioEl.srcObject == null) outAudioEl.srcObject = runtime.getOutputAudioStream();
  const apply = outAudioEl.setSinkId
    ? outAudioEl.setSinkId(id).catch((e) => console.warn("[node-vj] setSinkId failed:", e))
    : Promise.resolve(console.warn("[node-vj] setSinkId 非対応のブラウザです"));
  void apply.then(() => outAudioEl.play().catch((e) => console.warn("[node-vj] output audio play failed:", e)));
});

// #198: 編集中シーンの音声（モニター）を別オーディオ出力デバイスへ発音する。編集音と出力音を独立
// デバイスへ振り分けられ、編集中シーンが出力から参照される構成でも重複して聞こえない（モニター/プログラム分離）。
monAudioSel.addEventListener("change", () => {
  runtime.resumeAudio();
  const id = monAudioSel.value;
  if (!id) {
    // 既定デバイスへ戻す（monitorBus → ctx.destination 直結。遅延が増えない）。
    runtime.setMonitorSeparation(false);
    monAudioEl.pause();
    return;
  }
  if (monAudioEl.srcObject == null) monAudioEl.srcObject = runtime.getMonitorAudioStream();
  const apply = monAudioEl.setSinkId
    ? monAudioEl.setSinkId(id).catch((e) => console.warn("[node-vj] monitor setSinkId failed:", e))
    : Promise.resolve(console.warn("[node-vj] setSinkId 非対応のブラウザです"));
  void apply.then(() => {
    // setSinkId 確定後にモニターバスを選択デバイスへ繋ぎ替える。
    runtime.setMonitorSeparation(true);
    return monAudioEl.play().catch((e) => console.warn("[node-vj] monitor audio play failed:", e));
  });
});

if (navigator.mediaDevices) {
  void refreshAudioOutputs();
  navigator.mediaDevices.addEventListener?.("devicechange", () => void refreshAudioOutputs());
}
bar.appendChild(monAudioSel);
bar.appendChild(outAudioSel);

document.body.appendChild(bar);

(window as unknown as { nodeVj: unknown }).nodeVj = { graph, registry, runtime, editor, sceneManager, recorder };
console.log("[node-vj] editor + preview started");
