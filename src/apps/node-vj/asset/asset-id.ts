/** SHA-256 を 16 進文字列で返す。アセット内容ハッシュ（重複排除 id）に使う。 */
export async function hashBytes(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** File（または arrayBuffer を持つもの）の内容ハッシュ。 */
export async function hashFile(file: { arrayBuffer(): Promise<ArrayBuffer> }): Promise<string> {
  return hashBytes(await file.arrayBuffer());
}
