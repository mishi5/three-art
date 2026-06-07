/**
 * ファイル名 / サイズ / 先頭バイトから 32-bit FNV-1a ベースの短い識別子を作る。
 * 暗号学的強度は要らず、AnalysisCache のキーとして衝突しない程度で十分。
 */
export function fileHash(name: string, size: number, headBytes: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < headBytes.length; i++) {
    h ^= headBytes[i] ?? 0;
    h = Math.imul(h, 0x01000193);
  }
  return `${encodeURIComponent(name)}-${size}-${(h >>> 0).toString(16)}`;
}
