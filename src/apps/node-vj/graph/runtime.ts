// グラフランタイム（ADR #59）。renderer/scene/camera を持ち、毎フレーム
// グラフを評価して描画する。visual/sink ノードの永続状態の生成・破棄も管理する。
import * as THREE from "three";
import { DEFAULT_AUDIO_FEATURES, type AudioFeatures } from "../../../core/types";
import { evaluate } from "./evaluator";
import { findNode, type GraphDoc } from "./graph-doc";
import type { NodeEnv, NodeRegistry, NodeState } from "./node-type";

export class GraphRuntime {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  private states = new Map<string, NodeState>();
  private audio: AudioFeatures = DEFAULT_AUDIO_FEATURES;
  private rafId: number | null = null;
  private startMs: number | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    private readonly registry: NodeRegistry,
    private graph: GraphDoc,
  ) {
    this.scene.background = new THREE.Color(0x000000);
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.01, 100);
    this.camera.position.set(0, 0, 2.4);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  }

  setGraph(graph: GraphDoc): void {
    this.graph = graph;
  }

  setAudio(audio: AudioFeatures): void {
    this.audio = audio;
  }

  setSize(w: number, h: number): void {
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private env(): NodeEnv {
    return { scene: this.scene, audio: this.audio };
  }

  /** グラフに合わせて visual/sink ノードの永続状態を生成・破棄する。 */
  private syncStates(): void {
    const env = this.env();
    const alive = new Set(this.graph.nodes.map((n) => n.id));
    // 削除されたノードの state を破棄
    for (const [id, state] of [...this.states.entries()]) {
      if (!alive.has(id)) {
        const node = findNode(this.graph, id);
        const def = node ? this.registry.get(node.type) : undefined;
        def?.disposeState?.(state, env);
        this.states.delete(id);
      }
    }
    // createState を持つノードで未生成のものを生成
    for (const node of this.graph.nodes) {
      const def = this.registry.get(node.type);
      if (def?.createState && !this.states.has(node.id)) {
        this.states.set(node.id, def.createState(env));
      }
    }
  }

  /** 1 フレーム評価して描画する。 */
  tick(nowMs: number): void {
    if (this.startMs === null) this.startMs = nowMs;
    const timeSec = (nowMs - this.startMs) / 1000;
    this.syncStates();
    evaluate(this.graph, this.registry, {
      timeSec,
      env: this.env(),
      state: (id) => this.states.get(id),
    });
    this.renderer.render(this.scene, this.camera);
  }

  start(): void {
    const loop = (ms: number): void => {
      this.rafId = requestAnimationFrame(loop);
      this.tick(ms);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  stop(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }
}
