export const CACHE_VERSION = 1;

const KEY_PREFIX = "pose-particles.analysis.v1.";

// 中身の型は段階的に厳密化される。AnalysisCache 自体は "不透明な payload" として扱う。
export interface BandFrame {
  t: number; volume: number; bass: number; mid: number; treble: number;
}
export interface BandTimeSeries {
  duration: number; frames: BandFrame[]; sampleRate: number;
}
export interface SectionBoundary { t: number; source: "auto" | "user-add"; }
export interface Section {
  start: number; end: number;
  energyNorm: number; bassAbs: number; midAbs: number; trebleAbs: number;
}

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
