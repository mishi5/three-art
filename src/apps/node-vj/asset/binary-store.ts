/** アセットのバイナリ本体を保存するストア。本番は OPFS、テストは memory。 */
export interface BinaryStore {
  put(id: string, blob: Blob): Promise<void>;
  getFile(id: string): Promise<File | null>;
  delete(id: string): Promise<void>;
  has(id: string): Promise<boolean>;
}

/** メモリ上に Blob を保持するテスト用アダプタ。 */
export function memoryBinaryStore(): BinaryStore {
  const m = new Map<string, Blob>();
  return {
    async put(id, blob) { m.set(id, blob); },
    async getFile(id) { const b = m.get(id); return b ? new File([b], id, { type: b.type }) : null; },
    async delete(id) { m.delete(id); },
    async has(id) { return m.has(id); },
  };
}

/** OPFS にバイナリを保存する本番アダプタ（手動確認）。createWritable でストリーム書き込み。 */
export function opfsBinaryStore(dirName = "node-vj-assets"): BinaryStore {
  async function dir(): Promise<FileSystemDirectoryHandle> {
    const root = await navigator.storage.getDirectory();
    return await root.getDirectoryHandle(dirName, { create: true });
  }
  return {
    async put(id, blob) {
      const d = await dir();
      const fh = await d.getFileHandle(id, { create: true });
      const w = await fh.createWritable();
      await blob.stream().pipeTo(w);
    },
    async getFile(id) {
      try { const d = await dir(); const fh = await d.getFileHandle(id); return await fh.getFile(); }
      catch { return null; }
    },
    async delete(id) {
      try { const d = await dir(); await d.removeEntry(id); } catch { /* ない場合は無視 */ }
    },
    async has(id) {
      try { const d = await dir(); await d.getFileHandle(id); return true; } catch { return false; }
    },
  };
}
