// #151: 全シーン（SceneSet）の localStorage 永続化。GraphStore と同パターン。
import type { KvStorage } from "../graph/graph-store";
import type { GraphDoc } from "../graph/graph-doc";

export interface Scene { id: string; name: string; graph: GraphDoc; }
export interface SceneSet {
  version: number;
  scenes: Scene[];
  activeId: string;
  /** #174: 出力シーン id。未指定（null/undefined）は編集シーンへ追従。 */
  outputId?: string | null;
}

export const SCENE_SET_VERSION = 1;
const KEY = "node-vj.scenes.v1";

/** 全シーン（SceneSet）を localStorage に保存/復元する。破損・不正は null。 */
export class SceneStore {
  constructor(private readonly storage: KvStorage) {}

  load(): SceneSet | null {
    try {
      const raw = this.storage.getItem(KEY);
      if (!raw) return null;
      const s = JSON.parse(raw) as Partial<SceneSet>;
      if (s.version !== SCENE_SET_VERSION) return null;
      if (!Array.isArray(s.scenes) || s.scenes.length === 0) return null;
      if (typeof s.activeId !== "string") return null;
      return s as SceneSet;
    } catch {
      return null;
    }
  }

  save(set: SceneSet): void {
    this.storage.setItem(KEY, JSON.stringify(set));
  }
}
