// 名前付きグラフプリセットの保存（#65）。pose-particles の storage adapter
// パターンを踏襲し、テストでは memory adapter を注入する。
const KEY_PREFIX = "node-vj.graphs.v1.";
const INDEX_KEY = "node-vj.graphs.v1-index";

export interface KvStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function localStorageAdapter(): KvStorage {
  return localStorage;
}

export function memoryAdapter(): KvStorage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => { m.set(k, v); },
    removeItem: (k) => { m.delete(k); },
  };
}

/** 名前付きグラフ YAML の保存・読込・削除・一覧。 */
export class GraphStore {
  constructor(private readonly storage: KvStorage) {}

  list(): string[] {
    try {
      const raw = this.storage.getItem(INDEX_KEY);
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      return [];
    }
  }

  save(name: string, yamlText: string): void {
    if (!name.trim()) throw new Error("プリセット名が空です");
    this.storage.setItem(KEY_PREFIX + name, yamlText);
    const names = this.list();
    if (!names.includes(name)) {
      names.push(name);
      this.storage.setItem(INDEX_KEY, JSON.stringify(names));
    }
  }

  load(name: string): string | null {
    return this.storage.getItem(KEY_PREFIX + name);
  }

  remove(name: string): void {
    this.storage.removeItem(KEY_PREFIX + name);
    const names = this.list().filter((n) => n !== name);
    this.storage.setItem(INDEX_KEY, JSON.stringify(names));
  }
}
