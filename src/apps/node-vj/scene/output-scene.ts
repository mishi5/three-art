// #174: 出力シーンの解決（純関数）。
// 出力先 id が未指定（null）または存在しない場合はアクティブ（編集）シーンへ追従する。

function asSet(ids: Iterable<string>): Set<string> {
  return ids instanceof Set ? ids : new Set(ids);
}

/** 出力先が有効なシーンにピン留めされているか（id が指定され、かつ存在する）。 */
function hasValidPin(outputId: string | null | undefined, existingIds: Iterable<string>): boolean {
  return !!outputId && asSet(existingIds).has(outputId);
}

/**
 * 実効的な出力シーン id を返す。
 * - outputId が null / 空 / existingIds に無い → activeId（編集に追従）
 * - それ以外 → outputId（ピン留め。activeId と同じでもピンとして扱う）
 */
export function effectiveOutputSceneId(
  outputId: string | null | undefined,
  activeId: string,
  existingIds: Iterable<string>,
): string {
  return hasValidPin(outputId, existingIds) ? (outputId as string) : activeId;
}

/** 出力が編集シーンに追従中か（明示ピンが無い、または無効でフォールバック中）。 */
export function isFollowingEdit(
  outputId: string | null | undefined,
  existingIds: Iterable<string>,
): boolean {
  return !hasValidPin(outputId, existingIds);
}
