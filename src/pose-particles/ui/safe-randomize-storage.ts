/**
 * Safe Randomize (Issue #46) の除外 path 集合を localStorage に保存・復元する。
 * Settings 本体 (`settings.ts`) と同様に try/catch でストレージ未利用環境に
 * フォールバックする。
 */
import { DEFAULT_SAFE_EXCLUDED } from "./randomize";

export const SAFE_EXCLUDED_STORAGE_KEY = "pose-particles.safe-randomize-excluded.v1";

function defaultSet(): Set<string> {
  return new Set(DEFAULT_SAFE_EXCLUDED);
}

/**
 * 保存値が string[] でない / 壊れている場合は DEFAULT_SAFE_EXCLUDED を返す。
 * 空配列は「ユーザが全部外した」状態として尊重する (空 Set を返す)。
 */
export function loadExcludedPaths(): Set<string> {
  try {
    const raw = localStorage.getItem(SAFE_EXCLUDED_STORAGE_KEY);
    if (raw === null) return defaultSet();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return defaultSet();
    if (!parsed.every((x) => typeof x === "string")) return defaultSet();
    return new Set(parsed as string[]);
  } catch {
    return defaultSet();
  }
}

export function saveExcludedPaths(paths: ReadonlySet<string>): void {
  try {
    localStorage.setItem(SAFE_EXCLUDED_STORAGE_KEY, JSON.stringify([...paths]));
  } catch {
    // quota / privacy mode で書込不能なら諦める (settings.ts と同じ方針)
  }
}
