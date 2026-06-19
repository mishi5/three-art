import { FileAudioSource } from "../../../core/audio/FileAudioSource";
import * as SongAnalyzer from "../../../core/audio/SongAnalyzer";
import { detect } from "../../../core/audio/SectionDetector";
import type { SectionBoundary } from "../../../core/audio/analysis-types";
import { DEFAULT_AUDIO_FEATURES, type AudioFeatures } from "../../../core/types";
import type { NodeState, NodeTypeDef } from "../graph/node-type";
import { sectionIndexAt } from "./input-node-logic";
import { AUDIO_FEATURE_OUTPUTS, ONSET_PARAMS, OnsetTracker, audioFeatureOutputs, readOnsetParams } from "./audio-feature-logic";
import type { PlaybackControl } from "./playback";

/**
 * 音声ファイル入力の永続状態（#100）。loadFile（user gesture）でファイルを読み込み、
 * SongAnalyzer + SectionDetector で section 境界を算出して再生位置に応じた section を返す。
 */
export class AudioFileInputRuntime implements PlaybackControl {
  private source: FileAudioSource | null = null;
  boundaries: SectionBoundary[] = [];
  started = false;
  /** #99: ノード上に表示する現在のファイル名（未選択は null）。 */
  fileName: string | null = null;
  private ctx: AudioContext | null = null;
  private onset = new OnsetTracker();
  /** #115: ループ再生 ON/OFF。loadFile 前の指定も保持し、読込後の source に適用する。 */
  private loop = true;

  private getCtx(): AudioContext {
    return (this.ctx ??= new AudioContext());
  }

  /** #115: ループ ON/OFF を設定（再生中・未読込どちらでも保持）。 */
  setLoop(loop: boolean): void {
    this.loop = loop;
    this.source?.setLoop(loop);
  }

  /** ファイルを読み込んで再生し、section 解析を実行する。 */
  async loadFile(file: File): Promise<void> {
    // #125: 既存の再生中音源を停止してから差し替える（1 ノード 1 音源・多重再生防止）。
    this.source?.stop();
    this.source = null;
    this.started = false;
    this.fileName = file.name;
    const src = new FileAudioSource(this.getCtx());
    src.setLoop(this.loop);
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

  detectOnset(bass: number, t: number, threshold: number, cooldown: number): boolean {
    return this.onset.detect(bass, t, threshold, cooldown);
  }

  // --- PlaybackControl（#99）---
  isPlaying(): boolean {
    return this.source?.isPlaying() ?? false;
  }

  togglePlay(): void {
    this.source?.togglePause();
  }

  getCurrentTime(): number {
    return this.currentTime();
  }

  getDuration(): number {
    return this.source?.getDecodedBuffer()?.duration ?? 0;
  }

  seek(t: number): void {
    this.source?.seek(t);
  }

  dispose(): void {
    this.source?.stop();
  }
}

/** 音声ファイル入力ノード（#100）。audio / 各バンド / onset に加え section(number) を出力。 */
export const AudioFileInputNode: NodeTypeDef = {
  type: "AudioFileInput",
  category: "input",
  description: "音声ファイルを再生して入力するノード。audio / 各バンド / onset に加え、楽曲解析した section を出力する。",
  isSink: false,
  fileInput: { accept: "audio/*" },
  inputs: [],
  outputs: [...AUDIO_FEATURE_OUTPUTS, { id: "section", label: "section", type: "number", description: "再生位置から判定した現在の楽曲セクション番号（0 始まり、未再生は -1）。" }],
  params: [
    { id: "loop", label: "loop", kind: "enum", default: "on", options: ["on", "off"], description: "ループ再生の ON/OFF。" },
    ...ONSET_PARAMS,
  ],
  createState: () => new AudioFileInputRuntime(),
  disposeState: (state: NodeState) => (state as AudioFileInputRuntime).dispose(),
  evaluate: (ctx) => {
    const s = ctx.state as AudioFileInputRuntime | undefined;
    if (!s) return { ...audioFeatureOutputs(DEFAULT_AUDIO_FEATURES, false), section: -1 };
    s.setLoop(ctx.param("loop") !== "off");
    const audio = s.read();
    const { threshold, cooldown } = readOnsetParams(ctx.param);
    const onset = s.detectOnset(audio.bass, ctx.timeSec, threshold, cooldown);
    const section = s.started ? sectionIndexAt(s.boundaries, s.currentTime()) : -1;
    return { ...audioFeatureOutputs(audio, onset), section };
  },
};
