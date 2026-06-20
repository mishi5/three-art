// #103: ノード追加メニューのカテゴリ分け（純関数）。
// ツールバー整理と右クリック追加メニューの両方で共有する。

/** 表示順のカテゴリ。これ以外（未設定含む）は末尾の "other" にまとめる。
 *  generator = 値/時間/形状の生成元（Number/Time/PointShape）。input は外部入力（Camera/Mic 等）専用。 */
export const CATEGORY_ORDER = ["input", "generator", "process", "visual", "effect", "output"] as const;

export interface NodeMenuGroup {
  category: string;
  /** そのカテゴリの node type 一覧（入力順を維持）。 */
  types: string[];
}

/**
 * ノード定義をカテゴリ別にグルーピングする。CATEGORY_ORDER の順に並べ、
 * 未知/未設定カテゴリは末尾 "other" に集約する。空カテゴリは含めない。
 * 各カテゴリ内の type は入力（レジストリ登録）順を維持する。
 */
export function groupNodesByCategory(
  defs: ReadonlyArray<{ type: string; category?: string }>,
): NodeMenuGroup[] {
  const known = new Set<string>(CATEGORY_ORDER);
  const buckets = new Map<string, string[]>();
  for (const def of defs) {
    const cat = def.category && known.has(def.category) ? def.category : "other";
    const list = buckets.get(cat) ?? [];
    list.push(def.type);
    buckets.set(cat, list);
  }
  const groups: NodeMenuGroup[] = [];
  for (const cat of CATEGORY_ORDER) {
    const types = buckets.get(cat);
    if (types && types.length) groups.push({ category: cat, types });
  }
  const other = buckets.get("other");
  if (other && other.length) groups.push({ category: "other", types: other });
  return groups;
}
