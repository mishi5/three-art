import type { AssetKind } from "./asset-kind";

export interface AssetMeta {
  id: string;
  kind: AssetKind;
  fileName: string;
  mime: string;
  size: number;
  thumbnail: Blob | null;
  createdAt: number;
}

export interface MetaStore {
  list(): Promise<AssetMeta[]>;
  get(id: string): Promise<AssetMeta | null>;
  put(meta: AssetMeta): Promise<void>;
  delete(id: string): Promise<void>;
}

/** メモリ上に AssetMeta を保持するテスト用アダプタ。list は createdAt 昇順。 */
export function memoryMetaStore(): MetaStore {
  const m = new Map<string, AssetMeta>();
  return {
    async list() { return [...m.values()].sort((a, b) => a.createdAt - b.createdAt); },
    async get(id) { return m.get(id) ?? null; },
    async put(meta) { m.set(meta.id, meta); },
    async delete(id) { m.delete(id); },
  };
}

/** IndexedDB に AssetMeta を保存する本番アダプタ（手動確認）。 */
export function indexedDbMetaStore(dbName = "node-vj-assets"): MetaStore {
  const STORE = "meta";
  function open(): Promise<IDBDatabase> {
    return new Promise((res, rej) => {
      const req = indexedDB.open(dbName, 1);
      req.onupgradeneeded = () => { req.result.createObjectStore(STORE, { keyPath: "id" }); };
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  }
  async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await open();
    return new Promise<T>((res, rej) => {
      const r = fn(db.transaction(STORE, mode).objectStore(STORE));
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    }).finally(() => db.close());
  }
  return {
    async list() {
      const all = await tx<AssetMeta[]>("readonly", (s) => s.getAll() as IDBRequest<AssetMeta[]>);
      return all.sort((a, b) => a.createdAt - b.createdAt);
    },
    async get(id) { return (await tx<AssetMeta | undefined>("readonly", (s) => s.get(id))) ?? null; },
    async put(meta) { await tx("readwrite", (s) => s.put(meta)); },
    async delete(id) { await tx("readwrite", (s) => s.delete(id)); },
  };
}
