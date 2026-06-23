// グラフランタイム（ADR #59 / #76）。renderer/camera を持ち、毎フレーム
// グラフを評価して描画する。visual は専用シーン→RT に描いて texture を返すため、
// canvas への書き込み（転写）はここに一元化する（クリア順序のバグ防止）。
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { DEFAULT_AUDIO_FEATURES, type AudioFeatures } from "../../../core/types";
import { evaluate } from "./evaluator";
import type { GraphDoc } from "./graph-doc";
import type { NodeEnv, NodeRegistry, NodeState, NodeTypeDef } from "./node-type";
import { pickScreenTextures } from "./texture-screen";
import { collectSceneRefs, sceneRenderOrder } from "../scene/scene-refs";
import { TextureBlitter } from "./blit";
import { PREVIEW_W, PREVIEW_H } from "./preview";
import { BackgroundTicker } from "./background-ticker";

/** 背面駆動 ticker の fps（#148: 出力ウィンドウ全画面で本体が隠れても回し続ける）。 */
const BG_TICK_FPS = 60;

/** プレビュー読み戻しの間引き（N フレームに 1 回。readback ストール軽減）。 */
const PREVIEW_INTERVAL = 3;

export class GraphRuntime {
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  private readonly controls: OrbitControls;
  private readonly blitter = new TextureBlitter();
  private states = new Map<string, NodeState>();
  /** state を生成した NodeTypeDef を控える（ノード削除後も disposeState を確実に呼ぶため）。 */
  private stateDefs = new Map<string, NodeTypeDef>();
  private audio: AudioFeatures = DEFAULT_AUDIO_FEATURES;
  /** #127/#128: 全 audio ノードで共有する AudioContext（遅延生成）。 */
  private audioCtx: AudioContext | null = null;
  private rafId: number | null = null;
  private startMs: number | null = null;
  private lastOutputs = new Map<string, Record<string, unknown>>();
  // #77: ノードプレビュー小窓。texture を小 RT へ縮小転写し読み戻して 2D canvas 化する。
  private previewRT = new THREE.WebGLRenderTarget(PREVIEW_W, PREVIEW_H);
  private previewPixels = new Uint8Array(PREVIEW_W * PREVIEW_H * 4);
  private previewCanvases = new Map<string, HTMLCanvasElement>();
  private frameCount = 0;
  // #148: 本体が hidden の間も描画を回すための Worker 駆動 ticker（出力ウィンドウ表示中のみ）。
  private keepAliveWhileHidden = false;
  private bgTicker: BackgroundTicker | null = null;
  private visHandler: (() => void) | null = null;
  // #152: シーンをノード化する参照解決。アクティブ以外のシーンを専用 state/RT で事前評価する。
  private sceneProvider: ((id: string) => GraphDoc | null) | null = null;
  private activeSceneId = "";
  private sceneRes = new Map<string, { states: Map<string, NodeState>; defs: Map<string, NodeTypeDef>; rt: THREE.WebGLRenderTarget }>();
  private sceneTextureCache = new Map<string, THREE.Texture>();

  constructor(
    canvas: HTMLCanvasElement,
    private readonly registry: NodeRegistry,
    private graph: GraphDoc,
  ) {
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.01, 100);
    this.camera.position.set(0, 0, 1.8);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    // プレビューを回転・ズームしてビジュアルをフレーミングできるようにする。
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 0.3;
    this.controls.maxDistance = 30;
  }

  setGraph(graph: GraphDoc): void {
    this.graph = graph;
  }

  /** #152: シーン id → GraphDoc を引く provider と現在のアクティブシーン id を設定する。 */
  setSceneProvider(provider: (id: string) => GraphDoc | null, activeSceneId: string): void {
    this.sceneProvider = provider;
    this.activeSceneId = activeSceneId;
  }

  /** ノードの永続状態を取得する（入力ノードの start() を user gesture から呼ぶ用）。 */
  getState(nodeId: string): NodeState | undefined {
    return this.states.get(nodeId);
  }

  /**
   * #154: 次フレームを待たずに state を即時生成・破棄する。
   * ノードを動的追加した直後に getState→loadFile したいとき（アセット D&D 生成）に使う。
   */
  ensureStates(): void {
    this.syncStates();
  }

  /** 直近フレームの評価結果（ノードの出力ポート値）。エディタのライブ表示用。 */
  getOutputs(nodeId: string): Record<string, unknown> | undefined {
    return this.lastOutputs.get(nodeId);
  }

  setAudio(audio: AudioFeatures): void {
    this.audio = audio;
  }

  setSize(w: number, h: number): void {
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /**
   * #148: 表示 CSS サイズを変えずに「描画解像度（drawing buffer）」だけ設定する。
   * 出力ウィンドウ表示中は PiP の見た目サイズに依らず高解像度で描き、captureStream を鮮明にする。
   * updateStyle=false で canvas の style を触らない（CSS は呼び出し側が制御）。
   */
  setRenderSize(w: number, h: number, pixelRatio: number): void {
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** #127/#128: 共有 AudioContext を遅延生成して返す。 */
  private getAudioContext(): AudioContext {
    return (this.audioCtx ??= new AudioContext());
  }

  /** user gesture から共有 AudioContext を resume する（発音に必要）。 */
  resumeAudio(): void {
    void this.getAudioContext().resume().catch(() => { /* gesture 不足時は次回 */ });
  }

  private env(): NodeEnv {
    return {
      audio: this.audio,
      renderer: this.renderer,
      camera: this.camera,
      audioContext: this.getAudioContext(),
      sceneTexture: (id) => this.sceneTextureCache.get(id) ?? null,
    };
  }

  /** グラフに合わせて visual/sink ノードの永続状態を生成・破棄する。 */
  private syncStates(): void {
    const env = this.env();
    const alive = new Set(this.graph.nodes.map((n) => n.id));
    // 削除されたノードの state を破棄。ノードは既にグラフから消えているため、
    // 生成時に控えた def を使って disposeState を確実に呼ぶ。
    for (const [id, state] of [...this.states.entries()]) {
      if (!alive.has(id)) {
        this.stateDefs.get(id)?.disposeState?.(state, env);
        this.states.delete(id);
        this.stateDefs.delete(id);
      }
    }
    // createState を持つノードで未生成のものを生成
    for (const node of this.graph.nodes) {
      const def = this.registry.get(node.type);
      if (def?.createState && !this.states.has(node.id)) {
        this.states.set(node.id, def.createState(env));
        this.stateDefs.set(node.id, def);
      }
    }
  }

  /**
   * #152: アクティブグラフから参照される全シーンを依存順に評価し、
   * 各シーンを専用 RT へ合成して sceneTextureCache に積む。アクティブ自身は対象外。
   */
  private renderReferencedScenes(timeSec: number): void {
    const provider = this.sceneProvider;
    if (!provider) return;
    const order = this.collectSceneOrder();
    const alive = new Set(order);
    // 参照されなくなったシーンのリソースを破棄
    for (const [id, res] of [...this.sceneRes.entries()]) {
      if (!alive.has(id)) {
        const env = this.env();
        for (const [nid, st] of res.states) res.defs.get(nid)?.disposeState?.(st, env);
        res.rt.dispose();
        this.sceneRes.delete(id);
        this.sceneTextureCache.delete(id);
      }
    }
    for (const id of order) {
      const graph = provider(id);
      if (!graph) continue;
      const res = this.ensureSceneRes(id);
      this.syncStatesFor(graph, res);
      const outputs = evaluate(graph, this.registry, {
        timeSec, env: this.env(), state: (nid) => res.states.get(nid),
      });
      const textures = pickScreenTextures(graph, this.registry, outputs);
      const w = this.renderer.domElement.width;
      const h = this.renderer.domElement.height;
      if (res.rt.width !== w || res.rt.height !== h) res.rt.setSize(w, h);
      const prev = this.renderer.getRenderTarget();
      this.renderer.setRenderTarget(res.rt);
      this.renderer.clear();
      textures.forEach((tex, i) => this.blitter.blit(this.renderer, tex as THREE.Texture, i > 0));
      this.renderer.setRenderTarget(prev);
      this.sceneTextureCache.set(id, res.rt.texture);
    }
  }

  /** アクティブグラフ＋provider から到達する参照先シーンを依存順（leaf 先）で返す。 */
  private collectSceneOrder(): string[] {
    const provider = this.sceneProvider;
    if (!provider) return [];
    const graphOf = (id: string): GraphDoc | null => (id === this.activeSceneId ? this.graph : provider(id));
    const scenes: { id: string; graph: GraphDoc }[] = [{ id: this.activeSceneId, graph: this.graph }];
    const seen = new Set<string>([this.activeSceneId]);
    const stack = [...collectSceneRefs(this.graph, this.registry)];
    while (stack.length) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const g = graphOf(id);
      if (!g) continue;
      scenes.push({ id, graph: g });
      for (const ref of collectSceneRefs(g, this.registry)) stack.push(ref);
    }
    return sceneRenderOrder(this.activeSceneId, scenes, this.registry);
  }

  private ensureSceneRes(id: string): { states: Map<string, NodeState>; defs: Map<string, NodeTypeDef>; rt: THREE.WebGLRenderTarget } {
    let res = this.sceneRes.get(id);
    if (!res) {
      res = { states: new Map(), defs: new Map(), rt: new THREE.WebGLRenderTarget(2, 2, { depthBuffer: true }) };
      this.sceneRes.set(id, res);
    }
    return res;
  }

  /** 指定 graph 専用の state マップを同期する（syncStates のシーン版）。 */
  private syncStatesFor(graph: GraphDoc, res: { states: Map<string, NodeState>; defs: Map<string, NodeTypeDef> }): void {
    const env = this.env();
    const aliveIds = new Set(graph.nodes.map((n) => n.id));
    for (const [id, st] of [...res.states.entries()]) {
      if (!aliveIds.has(id)) { res.defs.get(id)?.disposeState?.(st, env); res.states.delete(id); res.defs.delete(id); }
    }
    for (const node of graph.nodes) {
      const def = this.registry.get(node.type);
      if (def?.createState && !res.states.has(node.id)) { res.states.set(node.id, def.createState(env)); res.defs.set(node.id, def); }
    }
  }

  /** 1 フレーム評価して描画する。 */
  tick(nowMs: number): void {
    if (this.startMs === null) this.startMs = nowMs;
    const timeSec = (nowMs - this.startMs) / 1000;
    this.syncStates();
    this.controls.update();
    // #152: アクティブグラフが参照する他シーンを依存順に事前評価し、各シーンを専用 RT へ合成。
    this.renderReferencedScenes(timeSec);
    // 評価: visual は各自の RT へ描画して texture を返す（canvas は触らない）。
    this.lastOutputs = evaluate(this.graph, this.registry, {
      timeSec,
      env: this.env(),
      state: (id) => this.states.get(id),
    });
    // 画面出力: Screen ノードの texture（なければ終端 visual）を canvas へ転写。
    // 1 枚目は通常合成、2 枚目以降は加算（旧・共有シーンでの加算合成相当）。
    const textures = pickScreenTextures(this.graph, this.registry, this.lastOutputs);
    this.renderer.setRenderTarget(null);
    this.renderer.clear();
    textures.forEach((tex, i) => {
      this.blitter.blit(this.renderer, tex as THREE.Texture, i > 0);
    });
    // #77: ノードプレビュー小窓の更新（間引きあり）。
    // #148: 本体 hidden の背面駆動中だけは小窓が不可視で readPixels の GPU ストールだけ残るのでスキップ。
    if (this.frameCount++ % PREVIEW_INTERVAL === 0 && !this.bgTicker?.running) this.updatePreviews();
  }

  /** preview ON のノードの texture を小 RT へ縮小転写→読み戻し→2D canvas 化する。 */
  private updatePreviews(): void {
    const alive = new Set<string>();
    for (const node of this.graph.nodes) {
      if (!node.preview) continue;
      const def = this.registry.get(node.type);
      const texPort = def?.outputs.find((p) => p.type === "texture");
      if (!texPort) continue;
      const tex = this.lastOutputs.get(node.id)?.[texPort.id] as THREE.Texture | undefined;
      if (!tex) continue;
      alive.add(node.id);
      // 縮小転写 → CPU へ読み戻し
      this.renderer.setRenderTarget(this.previewRT);
      this.renderer.clear();
      this.blitter.blit(this.renderer, tex, false);
      this.renderer.readRenderTargetPixels(this.previewRT, 0, 0, PREVIEW_W, PREVIEW_H, this.previewPixels);
      this.renderer.setRenderTarget(null);
      // WebGL の読み出しは上下逆のため、行を反転しながら ImageData へ詰める
      let canvas = this.previewCanvases.get(node.id);
      if (!canvas) {
        canvas = document.createElement("canvas");
        canvas.width = PREVIEW_W;
        canvas.height = PREVIEW_H;
        this.previewCanvases.set(node.id, canvas);
      }
      const ctx2d = canvas.getContext("2d");
      if (!ctx2d) continue;
      const image = ctx2d.createImageData(PREVIEW_W, PREVIEW_H);
      const rowBytes = PREVIEW_W * 4;
      for (let y = 0; y < PREVIEW_H; y++) {
        const src = (PREVIEW_H - 1 - y) * rowBytes;
        image.data.set(this.previewPixels.subarray(src, src + rowBytes), y * rowBytes);
      }
      ctx2d.putImageData(image, 0, 0);
    }
    // OFF/削除されたノードの canvas を破棄
    for (const id of [...this.previewCanvases.keys()]) {
      if (!alive.has(id)) this.previewCanvases.delete(id);
    }
  }

  /** プレビュー小窓用の 2D canvas（preview ON かつ texture が得られたノードのみ）。 */
  getPreviewCanvas(nodeId: string): HTMLCanvasElement | undefined {
    return this.previewCanvases.get(nodeId);
  }

  /**
   * #79: プレビュー小窓の描画ソース。NodeTypeDef.previewSource（video 等）を優先し、
   * なければ texture 読み戻し canvas（#77）を返す。
   */
  getPreviewSource(nodeId: string): CanvasImageSource | undefined {
    const node = this.graph.nodes.find((n) => n.id === nodeId);
    const def = node ? this.registry.get(node.type) : undefined;
    if (node && def?.previewSource) {
      const state = this.states.get(nodeId);
      if (state !== undefined) {
        return def.previewSource(state, node) ?? undefined;
      }
      return undefined;
    }
    return this.previewCanvases.get(nodeId);
  }

  /** これまでに評価したフレーム数（診断/テスト用）。 */
  get frames(): number {
    return this.frameCount;
  }

  /**
   * #148: 出力ウィンドウ表示中など、本体が隠れても描画を回し続けるか。
   * on のとき document.hidden になると Worker タイマーで tick を駆動する
   * （rAF は背面スロットルで止まるため）。off で通常の rAF のみ。
   */
  setKeepAliveWhileHidden(on: boolean): void {
    this.keepAliveWhileHidden = on;
    this.updateBackgroundDriver();
  }

  /** 現在の可視状態と keepAlive 設定に応じて Worker 駆動の開始/停止を切り替える。 */
  private updateBackgroundDriver(): void {
    const needBg = this.keepAliveWhileHidden && typeof document !== "undefined" && document.hidden;
    if (needBg) {
      if (!this.bgTicker) this.bgTicker = new BackgroundTicker(BG_TICK_FPS, () => this.tick(performance.now()));
      this.bgTicker.start();
    } else {
      this.bgTicker?.stop();
    }
  }

  start(): void {
    const loop = (ms: number): void => {
      this.rafId = requestAnimationFrame(loop);
      // 背面駆動が動いている間は二重評価しない（可視に戻れば rAF が主になる）。
      if (!this.bgTicker?.running) this.tick(ms);
    };
    this.rafId = requestAnimationFrame(loop);
    this.visHandler = () => this.updateBackgroundDriver();
    document.addEventListener("visibilitychange", this.visHandler);
  }

  stop(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.bgTicker?.stop();
    if (this.visHandler) { document.removeEventListener("visibilitychange", this.visHandler); this.visHandler = null; }
  }
}
