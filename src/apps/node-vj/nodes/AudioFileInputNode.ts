import { FileAudioSource } from "../../../core/audio/FileAudioSource";
import * as SongAnalyzer from "../../../core/audio/SongAnalyzer";
import { detect } from "../../../core/audio/SectionDetector";
import type { SectionBoundary } from "../../../core/audio/analysis-types";
import { DEFAULT_AUDIO_FEATURES, type AudioFeatures } from "../../../core/types";
import type { NodeState, NodeTypeDef } from "../graph/node-type";
import { sectionIndexAt } from "./input-node-logic";
import { AUDIO_FEATURE_OUTPUTS, OnsetTracker, audioFeatureOutputs } from "./audio-feature-logic";

/**
 * 音声ファイル入力の永続状態（#100）。loadFile（user gesture）でファイルを読み込み、
 * SongAnalyzer + SectionDetector で section 境界を算出して再生位置に応じた section を返す。
 */
export class AudioFileInputRuntime {
  private source: FileAudioSource | null = null;
  boundaries: SectionBoundary[] = [];
  started = false;
  private ctx: AudioContext | null = null;
  private onset = new OnsetTracker();

  private getCtx(): AudioContext {
    return (this.ctx ??= new AudioContext());
  }

  /** ファイルを読み込んで再生し、section 解析を実行する。 */
  async loadFile(file: File): Promise<void> {
    const src = new FileAudioSource(this.getCtx());
    await src.loadFromFile(file);
    await src.start();
    this.source = src;
    this.started = true;
    const buffer = src.getDecodedBuffer();
    if (buffer) {
      const series = await SongAnalyzer.run(buffer);
      this.boundaries = detect(series, { noveltyThreshold: 0.7, minSectionSec: 4.0 }).boundaries;
    }
  }

  read(): AudioFeatures {
    return this.source?.read() ?? DEFAULT_AUDIO_FEATURES;
  }

  currentTime(): number {
    return this.source?.getCurrentTime() ?? 0;
  }

  detectOnset(bass: number, t: number): boolean {
    return this.onset.detect(bass, t);
  }

  dispose(): void {
    this.source?.stop();
  }
}

/** 音声ファイル入力ノード（#100）。audio / 各バンド / onset に加え section(number) を出力。 */
export const AudioFileInputNode: NodeTypeDef = {
  type: "AudioFileInput",
  category: "input",
  isSink: false,
  inputs: [],
  outputs: [...AUDIO_FEATURE_OUTPUTS, { id: "section", label: "section", type: "number" }],
  params: [],
  createState: () => new AudioFileInputRuntime(),
  disposeState: (state: NodeState) => (state as AudioFileInputRuntime).dispose(),
  evaluate: (ctx) => {
    const s = ctx.state as AudioFileInputRuntime | undefined;
    if (!s) return { ...audioFeatureOutputs(DEFAULT_AUDIO_FEATURES, false), section: -1 };
    const audio = s.read();
    const onset = s.detectOnset(audio.bass, ctx.timeSec);
    const section = s.started ? sectionIndexAt(s.boundaries, s.currentTime()) : -1;
    return { ...audioFeatureOutputs(audio, onset), section };
  },
};
