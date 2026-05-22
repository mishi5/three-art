import type { PresetBundle, PresetStorageAdapter } from "./types";

/** localStorage key (新規領域。既存 "pose-particles.settings.v1" とは別)。 */
export const PRESETS_STORAGE_KEY = "pose-particles.presets.v1";

/**
 * localStorage を裏にもつアダプタ。
 *
 * 読み取りは失敗しても throw しない (空 Bundle で続行)。書き込みは
 * QuotaExceededError 等を rethrow するので、呼び出し側で alert する。
 * globalThis.localStorage がない環境 (テストランナー初期状態) では
 * メモリも持たず read=空, write=no-op として安全に動く。
 */
export function localStorageAdapter(key: string = PRESETS_STORAGE_KEY): PresetStorageAdapter {
  return {
    read(): PresetBundle {
      const ls = getStorage();
      if (!ls) return emptyBundle();
      const raw = ls.getItem(key);
      if (raw === null) return emptyBundle();
      try {
        const parsed = JSON.parse(raw) as PresetBundle;
        if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.presets)) {
          return emptyBundle();
        }
        return parsed;
      } catch {
        return emptyBundle();
      }
    },
    write(bundle: PresetBundle): void {
      const ls = getStorage();
      if (!ls) return;
      ls.setItem(key, JSON.stringify(bundle));
    },
  };
}

function emptyBundle(): PresetBundle {
  return { version: 1, presets: [] };
}

function getStorage(): Storage | null {
  const ls = (globalThis as { localStorage?: Storage }).localStorage;
  return ls ?? null;
}
