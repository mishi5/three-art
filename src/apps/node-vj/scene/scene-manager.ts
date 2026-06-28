// #151: 複数シーン（GraphDoc）をメモリ保持し、操作のたびに永続化・変更通知する純ロジック。
import type { GraphDoc } from "../graph/graph-doc";
import { createGraph } from "../graph/graph-doc";
import type { Scene, SceneSet } from "./scene-store";
import { SceneStore, SCENE_SET_VERSION } from "./scene-store";

/** 単一シーンの SceneSet を作る（初回初期化用）。 */
export function singleSceneSet(graph: GraphDoc, id: string, name = "Scene 1"): SceneSet {
  return { version: SCENE_SET_VERSION, scenes: [{ id, name, graph }], activeId: id };
}

export interface SceneManagerDeps { store: SceneStore; genId?: () => string; }

export class SceneManager {
  private scenes: Scene[];
  private _activeId: string;
  /** #174: 出力シーン id。null は編集（アクティブ）シーンへ追従。 */
  private _outputId: string | null;
  private readonly store: SceneStore;
  private readonly genId: () => string;
  private counter = 0;
  private listeners = new Set<() => void>();

  constructor(deps: SceneManagerDeps, initial: SceneSet) {
    this.store = deps.store;
    this.genId = deps.genId ?? (() => `scene-${Date.now().toString(36)}-${(++this.counter).toString(36)}`);
    this.scenes = initial.scenes;
    this._activeId = initial.activeId;
    this._outputId = initial.outputId ?? null;
  }

  list(): Scene[] { return [...this.scenes]; }
  activeId(): string { return this._activeId; }
  active(): Scene { return this.byId(this._activeId); }
  /** #174: 出力シーン id（null は編集に追従）。 */
  outputId(): string | null { return this._outputId; }

  add(name?: string): Scene {
    const scene: Scene = { id: this.genId(), name: name ?? `Scene ${this.scenes.length + 1}`, graph: createGraph() };
    this.scenes.push(scene);
    this._activeId = scene.id;
    this.commit();
    return scene;
  }

  duplicate(id: string): Scene {
    const src = this.byId(id);
    const scene: Scene = { id: this.genId(), name: `${src.name} copy`, graph: structuredClone(src.graph) };
    const idx = this.scenes.findIndex((s) => s.id === id);
    this.scenes.splice(idx + 1, 0, scene);
    this._activeId = scene.id;
    this.commit();
    return scene;
  }

  remove(id: string): void {
    if (this.scenes.length <= 1) return; // 最低 1 シーンは残す
    const idx = this.scenes.findIndex((s) => s.id === id);
    if (idx < 0) return;
    this.scenes.splice(idx, 1);
    if (this._activeId === id) {
      this._activeId = this.scenes[Math.min(idx, this.scenes.length - 1)]!.id;
    }
    // #174: 出力先が消えたら編集に追従（null）へ戻す。
    if (this._outputId === id) this._outputId = null;
    this.commit();
  }

  /** #174: 出力シーンをピン留め（null で編集に追従へ戻す）。 */
  setOutput(id: string | null): void {
    this._outputId = id && this.scenes.some((s) => s.id === id) ? id : null;
    this.commit();
  }

  rename(id: string, name: string): void { this.byId(id).name = name; this.commit(); }

  setActive(id: string): void {
    if (this.scenes.some((s) => s.id === id)) { this._activeId = id; this.commit(); }
  }

  /** 編集中の共有グラフをアクティブシーンへ独立コピーで書き戻す。 */
  updateActiveGraph(graph: GraphDoc): void {
    this.active().graph = structuredClone(graph);
    this.commit();
  }

  /** 現在の集合を保存する（初期化直後など、変更を伴わない保存用）。 */
  persist(): void { this.store.save(this.toSet()); }

  /** #201 現在の全シーン状態を SceneSet として取り出す（プロジェクト保存用）。 */
  toSceneSet(): SceneSet { return this.toSet(); }

  /**
   * #201 全シーンを差し替える（プロジェクト読込用）。activeId/outputId も置換し永続化・通知する。
   * activeId が scenes に無ければ先頭へフォールバック、outputId は scenes に無ければ null。
   */
  replaceAll(set: SceneSet): void {
    if (set.scenes.length === 0) throw new Error("replaceAll: scenes が空です");
    this.scenes = set.scenes;
    this._activeId = set.scenes.some((s) => s.id === set.activeId) ? set.activeId : set.scenes[0]!.id;
    this._outputId = set.outputId && set.scenes.some((s) => s.id === set.outputId) ? set.outputId : null;
    this.commit();
  }

  onChange(cb: () => void): () => void { this.listeners.add(cb); return () => { this.listeners.delete(cb); }; }

  private byId(id: string): Scene {
    const s = this.scenes.find((x) => x.id === id);
    if (!s) throw new Error(`scene not found: ${id}`);
    return s;
  }
  private toSet(): SceneSet { return { version: SCENE_SET_VERSION, scenes: this.scenes, activeId: this._activeId, outputId: this._outputId }; }
  private commit(): void { this.store.save(this.toSet()); for (const cb of this.listeners) cb(); }
}
