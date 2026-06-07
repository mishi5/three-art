// 解析結果のドメイン型は core/audio/analysis-types に集約。既存 import を壊さないよう
// ここから re-export する（このモジュールは localStorage キャッシュ機構を担う）。
import type {
  BandFrame, BandTimeSeries, SectionBoundary, Section,
} from "../../../core/audio/analysis-types";
export type {
  BandFrame, BandTimeSeries, SectionBoundary, Section,
} from "../../../core/audio/analysis-types";

export const CACHE_VERSION = 1;

const KEY_PREFIX = "pose-particles.analysis.v1.";

export interface CachePayload {
  version: number;
  series: BandTimeSeries;
  boundaries: SectionBoundary[];
  sections: Section[];
}

export const AnalysisCache = {
  get(hash: string): CachePayload | null {
    try {
      const raw = localStorage.getItem(KEY_PREFIX + hash);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as CachePayload;
      if (parsed.version !== CACHE_VERSION) return null;
      return parsed;
    } catch {
      return null;
    }
  },

  set(hash: string, payload: CachePayload): void {
    try {
      localStorage.setItem(KEY_PREFIX + hash, JSON.stringify(payload));
    } catch {
      /* quota や privacy mode は握り潰す */
    }
  },

  clear(hash: string): void {
    try {
      localStorage.removeItem(KEY_PREFIX + hash);
    } catch {
      /* ignore */
    }
  },
};
