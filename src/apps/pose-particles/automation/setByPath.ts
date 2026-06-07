/**
 * `"color.hueBase"` のようなドット記法で `obj` の階層に `value` を書き込む。
 * 途中のキーが存在しない / オブジェクトでない場合は何もしない (例外を投げない)。
 */
export function setByPath(
  obj: Record<string, unknown>,
  path: string,
  value: unknown,
): void {
  const parts = path.split(".");
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (key === undefined) return;
    const next = cur[key];
    if (next === null || next === undefined || typeof next !== "object" || Array.isArray(next)) {
      return;
    }
    cur = next as Record<string, unknown>;
  }
  const lastKey = parts[parts.length - 1];
  if (lastKey === undefined) return;
  cur[lastKey] = value;
}
