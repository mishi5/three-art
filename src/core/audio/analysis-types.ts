// 曲解析の結果ドメイン型（共有）。pose-particles の自動制御と node-vj の
// AudioInput ノードが共通で参照する。localStorage キャッシュ機構（AnalysisCache）は
// app 側の関心事として automation/ に残す。

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
