/**
 * 既存プリセット名の配列から、次に提案する "untitled #N" 名を返す。
 * N は既存の "untitled #<整数>" の最大値 + 1。該当が無ければ 1。
 */
export function nextDefaultPresetName(existingNames: string[]): string {
  let max = 0;
  const re = /^untitled #(\d+)$/;
  for (const n of existingNames) {
    const m = re.exec(n);
    if (!m) continue;
    const v = Number.parseInt(m[1] ?? "", 10);
    if (Number.isFinite(v) && v > max) max = v;
  }
  return `untitled #${max + 1}`;
}
