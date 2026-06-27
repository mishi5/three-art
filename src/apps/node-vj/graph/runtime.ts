// グラフランタイム（ADR #59 / #76）。renderer/camera を持ち、毎フレーム
// グラフを評価して描画する。visual は専用シーン→RT に描いて texture を返すため、
// canvas への書き込み（転写）はここに一元化する（クリア順序のバグ防止）。
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { DEFAULT_AUDIO_FEATURES, type AudioFeatures } from "../../../core/types";
import { evaluate } from "./evaluator";
import type { GraphDoc, NodeInstance } from "./graph-doc";
import type { NodeEnv, NodeRegistry, NodeState, NodeTypeDef } from "./node-type";
import { pickScreenTextures } from "./texture-screen";
import { collectSceneRefs, sceneRenderOrder } from "../scene/scene-refs";
import { effectiveOutputSceneId } from "../scene/output-scene";
import { outputAudioSourceId } from "../scene/output-audio";
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
  private sceneRes = new Map<string, { states: Map<string, NodeState>; defs: Map<string, NodeTypeDef>; rt: THREE.WebGLRenderTarget; audioMerge: GainNode; audioConnected: Set<AudioNode> }>();
  private sceneTextureCache = new Map<string, THREE.Texture>();
  // #172: 参照先シーンの音声（マージ gain）キャッシュと、参照先 state のアセット復元フック。
  private sceneAudioCache = new Map<string, AudioNode>();
  private sceneAssetRestorer: ((node: NodeInstance, state: NodeState) => void) | null = null;
  // #174: 出力シーン（編集と分離）。outputSceneId=null は編集（アクティブ）に追従。
  // outputActive のときだけ outputCanvas を毎フレーム更新する（出力ウィンドウ表示中）。
  private outputSceneId: string | null = null;
  private outputActive = false;
  private outputCanvas: HTMLCanvasElement | null = null;
  private outputCtx: CanvasRenderingContext2D | null = null;
  // #174: アクティブ（編集中）シーンが他シーン（出力シーン等）から SceneInput 参照されるとき、
  // active も RT へ合成して sceneTextureCache に積む（active は通常 canvas 直描きで cache に無いため）。
  private activeRT: THREE.WebGLRenderTarget | null = null;
  private activeReferenced = false;
  // #174: 同上の音声版。active の AudioOutput をここへもタップし sceneAudioCache[activeId] に供給する
  // （参照元シーンの SceneInput.audio / AudioMix が編集中シーンの音を解析できるようにする）。
  private activeAudioMerge: GainNode | null = null;
  private activeAudioConnected = new Set<AudioNode>();
  // #179: 録画用の音声分岐先。録画中フラグ（録画前の出力状態を退避し、停止時に戻す）。
  private recordDest: MediaStreamAudioDestinationNode | null = null;
  private outputActiveBeforeRecording = false;
  // #198: 出力シーンの音声を別オーディオ出力デバイスへ発音するための分岐先（遅延生成）。
  // ピン中の出力シーンの集約音声を毎フレーム接続/差し替えする。<audio>.setSinkId で任意デバイスへ。
  private outputAudioDest: MediaStreamAudioDestinationNode | null = null;
  private outputAudioConnected: AudioNode | null = null;
  // #198: 編集音（モニター）の発音先バス。active な AudioOutput はここへ繋ぎ、ランタイムが
  // 出力先を既定デバイス（ctx.destination）⇄ モニター選択デバイス（monitorAudioDest 経由）で繋ぎ替える。
  private monitorBus: GainNode | null = null;
  private monitorAudioDest: MediaStreamAudioDestinationNode | null = null;

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
    // #174: アクティブシーンが変わったら、旧 active の音声タップ状態と cache をリセットする。
    if (activeSceneId !== this.activeSceneId) {
      this.sceneAudioCache.delete(this.activeSceneId);
      this.activeAudioConnected.clear();
    }
    this.activeSceneId = activeSceneId;
  }

  /** #172: 参照先シーンの state 生成時にアセット（assetId）を復元する関数を設定する。 */
  setSceneAssetRestorer(fn: (node: NodeInstance, state: NodeState) => void): void {
    this.sceneAssetRestorer = fn;
  }

  /**
   * #174: アクティブ（編集中）シーンを newActiveId へ切り替える直前に、ノード state を破棄せず
   * 「アクティブ用ストア(this.states)」と「参照先用ストア(sceneRes[id].states)」の間で移譲する。
   * これで pin 中に編集シーンを切り替えても、再生中の動画/音声（state＝<video> 要素）が作り直されず
   * シーク位置を保ったまま継続する。実際の使用前（replaceGraph 前）に main から呼ぶ。
   */
  migrateActiveStates(newActiveId: string): void {
    const oldId = this.activeSceneId;
    if (oldId === newActiveId) return;
    // 旧アクティブの state を sceneRes[oldId] へ退避（出力/参照先として再利用＝再生継続）。
    if (this.states.size > 0) {
      const res = this.ensureSceneRes(oldId);
      for (const [nid, st] of this.states) res.states.set(nid, st);
      for (const [nid, def] of this.stateDefs) res.defs.set(nid, def);
      this.states = new Map();
      this.stateDefs = new Map();
    }
    // 新アクティブが参照先として state を持っていれば、それを採用（参照先→アクティブ＝再生継続）。
    const inc = this.sceneRes.get(newActiveId);
    if (inc && inc.states.size > 0) {
      this.states = inc.states;
      this.stateDefs = inc.defs;
      inc.states = new Map();
      inc.defs = new Map();
    }
  }

  /** #174: 出力シーン id を設定する（null は編集シーンへ追従）。 */
  setOutputSceneId(id: string | null): void {
    this.outputSceneId = id;
  }

  /** #174: 出力ウィンドウ表示中など、出力 canvas を毎フレーム更新するか。 */
  setOutputActive(on: boolean): void {
    this.outputActive = on;
  }

  /** #174: 出力ウィンドウが captureStream するための 2D 出力 canvas（遅延生成）。 */
  getOutputCanvas(): HTMLCanvasElement {
    if (!this.outputCanvas) {
      const c = document.createElement("canvas");
      c.width = this.renderer.domElement.width || 2;
      c.height = this.renderer.domElement.height || 2;
      this.outputCanvas = c;
      this.outputCtx = c.getContext("2d");
    }
    return this.outputCanvas;
  }

  /**
   * #174: 実効的な出力シーン id。outputSceneId が未指定 / 存在しないシーンなら
   * アクティブ（編集）シーンへ追従する。
   */
  private effectiveOutputId(): string {
    const provider = this.sceneProvider;
    const exists = (id: string): boolean => id === this.activeSceneId || (!!provider && !!provider(id));
    if (this.outputSceneId && exists(this.outputSceneId)) {
      return effectiveOutputSceneId(this.outputSceneId, this.activeSceneId, [this.outputSceneId]);
    }
    return this.activeSceneId;
  }

  /** #174: 現フレームの WebGL canvas を 2D 出力 canvas へコピーする（GPU 間 drawImage）。 */
  private copyToOutputCanvas(): void {
    const src = this.renderer.domElement;
    const dst = this.getOutputCanvas();
    if (dst.width !== src.width || dst.height !== src.height) {
      dst.width = src.width;
      dst.height = src.height;
    }
    this.outputCtx?.drawImage(src, 0, 0);
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

  /**
   * #179: 録画用の音声分岐先（MediaStreamAudioDestinationNode）を遅延生成する。
   * 無音でもサンプルが流れ続けるよう ConstantSource(offset 0) を keep-alive で常時接続する
   * （これが無いと、音が鳴っていない間は無音トラックにサンプルが出ず muxer が停止して
   * 映像ごと書き出されない。const0 は録画分岐のみで、スピーカー出力には影響しない）。
   */
  private getRecordingDestination(): MediaStreamAudioDestinationNode {
    if (!this.recordDest) {
      const ctx = this.getAudioContext();
      this.recordDest = ctx.createMediaStreamDestination();
      const keepAlive = ctx.createConstantSource();
      keepAlive.offset.value = 0;
      keepAlive.connect(this.recordDest);
      keepAlive.start();
    }
    return this.recordDest;
  }

  /**
   * #198: 出力シーンの音声を別オーディオ出力デバイスへ発音するための MediaStream を返す。
   * 分岐先（outputAudioDest）を遅延生成する。recordDest と同様、無音時もグラフを駆動し続ける
   * よう ConstantSource(offset 0) を keep-alive で常時接続する（消費側 <audio> が pull する限り
   * 停止しないが、recordDest と挙動を揃えるため付ける。スピーカー出力には影響しない）。
   * 隠し <audio>.srcObject にこの stream を流し、setSinkId(deviceId) で任意デバイスへ出す。
   */
  getOutputAudioStream(): MediaStream {
    if (!this.outputAudioDest) {
      const ctx = this.getAudioContext();
      this.outputAudioDest = ctx.createMediaStreamDestination();
      const keepAlive = ctx.createConstantSource();
      keepAlive.offset.value = 0;
      keepAlive.connect(this.outputAudioDest);
      keepAlive.start();
    }
    return this.outputAudioDest.stream;
  }

  /**
   * #198: 編集音（モニター）の発音先バス。active な AudioOutput はここへ繋ぐ（env 経由）。
   * 起動時は既定デバイス（ctx.destination）へ出す。setMonitorSeparation で選択デバイスへ繋ぎ替える。
   */
  private getMonitorBus(): GainNode {
    if (!this.monitorBus) {
      const ctx = this.getAudioContext();
      this.monitorBus = ctx.createGain();
      this.monitorBus.connect(ctx.destination);
    }
    return this.monitorBus;
  }

  /**
   * #198: モニター音声（編集音）を別オーディオ出力デバイスへ発音するための MediaStream を返す。
   * 分岐先（monitorAudioDest）を遅延生成する（outputAudioDest と同様、keep-alive 付き）。
   * 隠し <audio>.srcObject にこの stream を流し setSinkId(deviceId) で任意デバイスへ出す。
   */
  getMonitorAudioStream(): MediaStream {
    if (!this.monitorAudioDest) {
      const ctx = this.getAudioContext();
      this.monitorAudioDest = ctx.createMediaStreamDestination();
      const keepAlive = ctx.createConstantSource();
      keepAlive.offset.value = 0;
      keepAlive.connect(this.monitorAudioDest);
      keepAlive.start();
    }
    return this.monitorAudioDest.stream;
  }

  /**
   * #198: モニターバスの出力先を切り替える。on=選択デバイス（monitorAudioDest 経由）、
   * off=既定デバイス（ctx.destination）。AudioOutput 側は常に monitorBus へ繋ぐため、ここ 1 箇所の
   * 繋ぎ替えで編集音の発音デバイスが切り替わる。off 時は MediaStream 経路を介さず遅延が増えない。
   */
  setMonitorSeparation(on: boolean): void {
    const ctx = this.getAudioContext();
    const bus = this.getMonitorBus();
    try { bus.disconnect(); } catch { /* ignore */ }
    if (on) {
      this.getMonitorAudioStream(); // monitorAudioDest を生成
      if (this.monitorAudioDest) bus.connect(this.monitorAudioDest);
    } else {
      bus.connect(ctx.destination);
    }
  }

  /**
   * #198: 出力シーンの集約音声を outputAudioDest へ接続/差し替えする（ピン時のみ分離）。
   * outputAudioDest 未生成（デバイス未選択）なら何もしない＝オーバヘッドなし。変化時のみ繋ぎ替える。
   */
  private updateOutputAudioRouting(): void {
    const dest = this.outputAudioDest;
    if (!dest) return;
    const srcId = outputAudioSourceId({
      outputActive: this.outputActive,
      effectiveOutputId: this.effectiveOutputId(),
      activeSceneId: this.activeSceneId,
    });
    const src = srcId ? (this.sceneAudioCache.get(srcId) ?? null) : null;
    if (src === this.outputAudioConnected) return;
    if (this.outputAudioConnected) {
      try { this.outputAudioConnected.disconnect(dest); } catch { /* ignore */ }
    }
    if (src) {
      try { src.connect(dest); } catch { /* ignore */ }
    }
    this.outputAudioConnected = src;
  }

  /** user gesture から共有 AudioContext を resume する（発音に必要）。 */
  resumeAudio(): void {
    void this.getAudioContext().resume().catch(() => { /* gesture 不足時は次回 */ });
  }

  /** #174: アクティブシーンの音声タップ用 gain（destination 非接続。参照元が pull する）。 */
  private getActiveAudioMerge(): GainNode {
    return (this.activeAudioMerge ??= this.getAudioContext().createGain());
  }

  private env(): NodeEnv {
    return {
      audio: this.audio,
      renderer: this.renderer,
      camera: this.camera,
      audioContext: this.getAudioContext(),
      // #198: 編集音の発音先バス。AudioOutput はこれを ctx.destination の代わりに使う。
      monitorBus: this.getMonitorBus(),
      sceneTexture: (id) => this.sceneTextureCache.get(id) ?? null,
      sceneAudio: (id) => this.sceneAudioCache.get(id) ?? null,
      // #174: アクティブシーンの AudioOutput をタップして sceneAudioCache[activeId] に供給する。
      // これで出力シーン等がアクティブ（編集中）シーンを SceneInput 参照したとき、その音声も
      // 解析できる（bass 等の音響パラメータが効く）。destination へは AudioOutput が別途繋ぐので
      // タップ用 merge は destination 非接続（二重発音しない）。
      captureSceneAudio: (node) => {
        const merge = this.getActiveAudioMerge();
        if (!this.activeAudioConnected.has(node)) {
          try { node.connect(merge); } catch { /* ignore */ }
          this.activeAudioConnected.add(node);
        }
        this.sceneAudioCache.set(this.activeSceneId, merge);
      },
      // #179: AudioOutput はここへも分岐接続し、録画時に音声トラックとして取り出せるようにする。
      recordingDestination: this.getRecordingDestination(),
    };
  }

  /**
   * #179: 録画用の MediaStream を返す。映像は出力 canvas（出力シーンのピン/追従に追従）の
   * captureStream。withAudio のとき録画先（AudioOutput 分岐 + keep-alive）の音声トラックも足す。
   */
  getRecordingStream(fps = 30, withAudio = true): MediaStream {
    const canvas = this.getOutputCanvas() as HTMLCanvasElement & { captureStream?: (fps?: number) => MediaStream };
    // #179: captureStream を開始する前に出力 canvas をレンダラ解像度へ合わせる（録画途中の
    // 解像度変化を避け、高解像度で録り始める）。
    const rw = this.renderer.domElement.width, rh = this.renderer.domElement.height;
    if (rw > 0 && rh > 0 && (canvas.width !== rw || canvas.height !== rh)) {
      canvas.width = rw;
      canvas.height = rh;
    }
    const out = new MediaStream();
    if (typeof canvas.captureStream === "function") {
      for (const t of canvas.captureStream(fps).getVideoTracks()) out.addTrack(t);
    }
    if (withAudio) {
      for (const t of this.getRecordingDestination().stream.getAudioTracks()) out.addTrack(t);
    }
    return out;
  }

  /**
   * #179: 録画中フラグ。録画中は出力 canvas を更新し続ける（出力ウィンドウ未表示でも録画可能）。
   * 停止時は録画開始前の出力状態へ戻す。
   */
  setRecording(on: boolean): void {
    if (on) {
      this.outputActiveBeforeRecording = this.outputActive;
      this.outputActive = true;
    } else {
      this.outputActive = this.outputActiveBeforeRecording;
    }
  }

  /** #172: 参照先シーン評価用の env（destination 非接続・音声捕捉つき）。 */
  private sceneEnv(sceneId: string): NodeEnv {
    const res = this.ensureSceneRes(sceneId);
    return {
      ...this.env(),
      referencedScene: true,
      captureSceneAudio: (node) => {
        if (!res.audioConnected.has(node)) {
          try { node.connect(res.audioMerge); } catch { /* ignore */ }
          res.audioConnected.add(node);
        }
        this.sceneAudioCache.set(sceneId, res.audioMerge);
      },
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
    // #174: 出力シーンが編集と別なら、それも追加ルートとして専用 RT へ評価する。
    const outId = this.effectiveOutputId();
    const extraRoots = this.outputActive && outId !== this.activeSceneId ? [outId] : [];
    const order = this.collectSceneOrder(extraRoots);
    // #174: 描画する各シーンがアクティブシーンを参照しているか（出力シーン B が編集中 A を参照する等）。
    // 参照されていれば tick で active も RT に積む（active は canvas 直描きで cache に無いため）。
    this.activeReferenced = order.some((id) => {
      const g = provider(id);
      return g ? collectSceneRefs(g, this.registry).includes(this.activeSceneId) : false;
    });
    const alive = new Set(order);
    // 参照されなくなったシーンのリソースを破棄
    for (const [id, res] of [...this.sceneRes.entries()]) {
      if (!alive.has(id)) {
        const env = this.env();
        for (const [nid, st] of res.states) res.defs.get(nid)?.disposeState?.(st, env);
        res.rt.dispose();
        try { res.audioMerge.disconnect(); } catch { /* ignore */ }
        this.sceneRes.delete(id);
        this.sceneTextureCache.delete(id);
        this.sceneAudioCache.delete(id);
      }
    }
    for (const id of order) {
      const graph = provider(id);
      if (!graph) continue;
      const res = this.ensureSceneRes(id);
      const env = this.sceneEnv(id);
      this.syncStatesFor(graph, res, env);
      const outputs = evaluate(graph, this.registry, {
        timeSec, env, state: (nid) => res.states.get(nid),
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

  /**
   * アクティブグラフ＋provider から到達する参照先シーンを依存順（leaf 先）で返す。
   * #174: extraRoots（出力シーン等）も到達対象に含め、評価順に追記する。
   */
  private collectSceneOrder(extraRoots: string[] = []): string[] {
    const provider = this.sceneProvider;
    if (!provider) return [];
    const graphOf = (id: string): GraphDoc | null => (id === this.activeSceneId ? this.graph : provider(id));
    const scenes: { id: string; graph: GraphDoc }[] = [{ id: this.activeSceneId, graph: this.graph }];
    const seen = new Set<string>([this.activeSceneId]);
    const stack = [...collectSceneRefs(this.graph, this.registry), ...extraRoots];
    while (stack.length) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const g = graphOf(id);
      if (!g) continue;
      scenes.push({ id, graph: g });
      for (const ref of collectSceneRefs(g, this.registry)) stack.push(ref);
    }
    return sceneRenderOrder(this.activeSceneId, scenes, this.registry, extraRoots);
  }

  private ensureSceneRes(id: string): { states: Map<string, NodeState>; defs: Map<string, NodeTypeDef>; rt: THREE.WebGLRenderTarget; audioMerge: GainNode; audioConnected: Set<AudioNode> } {
    let res = this.sceneRes.get(id);
    if (!res) {
      res = {
        states: new Map(), defs: new Map(),
        rt: new THREE.WebGLRenderTarget(2, 2, { depthBuffer: true }),
        audioMerge: this.getAudioContext().createGain(),
        audioConnected: new Set(),
      };
      this.sceneRes.set(id, res);
    }
    return res;
  }

  /** 指定 graph 専用の state マップを同期する（syncStates のシーン版）。env は参照先用（sceneEnv）。 */
  private syncStatesFor(graph: GraphDoc, res: { states: Map<string, NodeState>; defs: Map<string, NodeTypeDef> }, env: NodeEnv): void {
    const aliveIds = new Set(graph.nodes.map((n) => n.id));
    for (const [id, st] of [...res.states.entries()]) {
      if (!aliveIds.has(id)) { res.defs.get(id)?.disposeState?.(st, env); res.states.delete(id); res.defs.delete(id); }
    }
    for (const node of graph.nodes) {
      const def = this.registry.get(node.type);
      if (def?.createState && !res.states.has(node.id)) {
        const st = def.createState(env);
        res.states.set(node.id, st);
        res.defs.set(node.id, def);
        // #172: 参照先シーンの音声/動画入力をアセットから復元して解析・再生を走らせる。
        if (def.fileInput && this.sceneAssetRestorer) {
          const assetId = (node.params as Record<string, unknown>).assetId;
          if (typeof assetId === "string" && assetId !== "") this.sceneAssetRestorer(node, st);
        }
      }
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
    // #174: アクティブシーンが他シーンから SceneInput 参照されている場合、active も RT へ合成して
    // sceneTextureCache に積む（次フレームの renderReferencedScenes が読む。1 フレーム遅延は VJ 用途で許容）。
    if (this.activeReferenced) {
      const w = this.renderer.domElement.width, h = this.renderer.domElement.height;
      if (!this.activeRT) this.activeRT = new THREE.WebGLRenderTarget(w, h, { depthBuffer: true });
      else if (this.activeRT.width !== w || this.activeRT.height !== h) this.activeRT.setSize(w, h);
      const prevRT = this.renderer.getRenderTarget();
      this.renderer.setRenderTarget(this.activeRT);
      this.renderer.clear();
      textures.forEach((tex, i) => this.blitter.blit(this.renderer, tex as THREE.Texture, i > 0));
      this.renderer.setRenderTarget(prevRT);
      this.sceneTextureCache.set(this.activeSceneId, this.activeRT.texture);
    } else if (this.activeRT && this.sceneTextureCache.get(this.activeSceneId) === this.activeRT.texture) {
      this.sceneTextureCache.delete(this.activeSceneId);
    }
    // #174: 出力シーンが編集と別シーンのとき、先に出力シーンの合成結果を canvas に描いて
    // 出力 canvas へコピーし、その後アクティブシーンを描き直す（画面プレビューはアクティブ）。
    const outId = this.outputActive ? this.effectiveOutputId() : this.activeSceneId;
    const separateOutput = this.outputActive && outId !== this.activeSceneId;
    if (separateOutput) {
      const outTex = this.sceneTextureCache.get(outId);
      this.renderer.setRenderTarget(null);
      this.renderer.clear();
      if (outTex) this.blitter.blit(this.renderer, outTex, false);
      this.copyToOutputCanvas();
    }
    this.renderer.setRenderTarget(null);
    this.renderer.clear();
    textures.forEach((tex, i) => {
      this.blitter.blit(this.renderer, tex as THREE.Texture, i > 0);
    });
    // #174: 出力が編集に追従中なら、アクティブを描いた canvas をそのまま出力 canvas へコピー。
    if (this.outputActive && !separateOutput) this.copyToOutputCanvas();
    // #198: 出力シーンの集約音声を別オーディオ出力デバイス分岐へ接続/差し替え（ピン時のみ分離）。
    this.updateOutputAudioRouting();
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
