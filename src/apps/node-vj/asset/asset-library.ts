import type { BinaryStore } from "./binary-store";
import type { MetaStore, AssetMeta } from "./meta-store";
import { kindFromMime, type AssetKind } from "./asset-kind";
import { hashFile } from "./asset-id";

export interface AssetLibraryDeps {
  binary: BinaryStore;
  meta: MetaStore;
  /** サムネ生成（DOM 依存）。テストでは null を返すスタブを注入。 */
  makeThumbnail?: (file: File, kind: AssetKind) => Promise<Blob | null>;
  now?: () => number;
}

/** OPFS(バイナリ) + IndexedDB(メタ) を束ねるアセットライブラリ。id=内容ハッシュで重複排除。 */
export class AssetLibrary {
  private listeners = new Set<() => void>();
  constructor(private readonly deps: AssetLibraryDeps) {}

  async add(file: File): Promise<AssetMeta | null> {
    const kind = kindFromMime(file.type);
    if (!kind) return null;
    const id = await hashFile(file);
    const existing = await this.deps.meta.get(id);
    if (existing) return existing;
    const thumbnail = this.deps.makeThumbnail ? await this.deps.makeThumbnail(file, kind) : null;
    const meta: AssetMeta = {
      id, kind, fileName: file.name, mime: file.type, size: file.size, thumbnail,
      createdAt: this.deps.now ? this.deps.now() : Date.now(),
    };
    await this.deps.binary.put(id, file);
    await this.deps.meta.put(meta);
    this.emit();
    return meta;
  }

  async remove(id: string): Promise<void> {
    await this.deps.meta.delete(id);
    await this.deps.binary.delete(id);
    this.emit();
  }

  list(): Promise<AssetMeta[]> { return this.deps.meta.list(); }
  getFile(id: string): Promise<File | null> { return this.deps.binary.getFile(id); }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }
  private emit(): void { for (const cb of this.listeners) cb(); }
}
