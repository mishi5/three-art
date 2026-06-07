import type { AudioInput } from "../../../core/audio/AudioInput";
import { MicAudioSource } from "../../../core/audio/MicAudioSource";
import { DisplayAudioSource } from "../../../core/audio/DisplayAudioSource";
import { FileAudioSource } from "../../../core/audio/FileAudioSource";
import { OnsetDetector } from "../../../core/audio/OnsetDetector";
import * as SongAnalyzer from "../../../core/audio/SongAnalyzer";
import { detect } from "../../../core/audio/SectionDetector";
import type { SectionBoundary } from "../../../core/audio/analysis-types";
import { DEFAULT_AUDIO_FEATURES, type AudioFeatures } from "../../../core/types";
import type { NodeState, NodeTypeDef } from "../graph/node-type";
import { sectionIndexAt } from "./input-node-logic";

type SourceKind = "mic" | "file" | "display";
const ONSET_THRESHOLD = 0.12;
const ONSET_COOLDOWN = 0.12;

/**
 * AudioInput ノードの永続状態。選択ソース（mic/file/display）の AudioInput を保持。
 * mic/display の start・file の loadFile は user gesture から呼ぶ。
 * file ソース時のみ SongAnalyzer+SectionDetector で section 境界を算出する。
 */
export class AudioInputRuntime {
  source: AudioInput | null = null;
  kind: SourceKind = "mic";
  boundaries: SectionBoundary[] = [];
  started = false;
  private ctx: AudioContext | null = null;
  private onset = new OnsetDetector();
  private prevWaveCount = 0;

  private getCtx(): AudioContext {
    return (this.ctx ??= new AudioContext());
  }

  /** mic / display を開始（kind=file の場合は loadFile を使う）。 */
  async start(): Promise<void> {
    if (this.kind === "file") return;
    const src = this.kind === "display"
      ? new DisplayAudioSource(this.getCtx())
      : new MicAudioSource(this.getCtx());
    await src.start();
    this.source = src;
    this.started = true;
  }

  /** ファイルを読み込んで再生し、section 解析を実行する。 */
  async loadFile(file: File): Promise<void> {
    this.kind = "file";
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
    return this.source instanceof FileAudioSource ? this.source.getCurrentTime() : 0;
  }

  /** onset 検出（新規 onset がこのフレームで発生したか）。 */
  detectOnset(bass: number, t: number): boolean {
    this.onset.update(bass, ONSET_THRESHOLD, ONSET_COOLDOWN, t);
    const count = this.onset.getWaveTimes().length;
    const fired = count > this.prevWaveCount;
    this.prevWaveCount = count;
    return fired;
  }

  dispose(): void {
    this.source?.stop();
  }
}

/** audio 入力ノード。audio / 各バンド(number) / onset(trigger) / section(number) を出力。 */
export const AudioInputNode: NodeTypeDef = {
  type: "AudioInput",
  category: "input",
  isSink: false,
  inputs: [],
  outputs: [
    { id: "audio", label: "audio", type: "audio" },
    { id: "volume", label: "volume", type: "number" },
    { id: "bass", label: "bass", type: "number" },
    { id: "mid", label: "mid", type: "number" },
    { id: "treble", label: "treble", type: "number" },
    { id: "onset", label: "onset", type: "trigger" },
    { id: "section", label: "section", type: "number" },
  ],
  params: [
    { id: "source", label: "source", kind: "enum", default: "mic", options: ["mic", "file", "display"] },
  ],
  createState: () => new AudioInputRuntime(),
  disposeState: (state: NodeState) => (state as AudioInputRuntime).dispose(),
  evaluate: (ctx) => {
    const s = ctx.state as AudioInputRuntime | undefined;
    if (!s) {
      const a = DEFAULT_AUDIO_FEATURES;
      return { audio: a, volume: 0, bass: 0, mid: 0, treble: 0, onset: false, section: -1 };
    }
    // mic/display は param の source を反映（file は loadFile が確定させる）。
    const sel = ctx.param("source") as SourceKind;
    if (sel !== "file" && s.kind !== "file") s.kind = sel;
    const audio = s.read();
    const onset = s.detectOnset(audio.bass, ctx.timeSec);
    const section = s.kind === "file" ? sectionIndexAt(s.boundaries, s.currentTime()) : -1;
    return {
      audio,
      volume: audio.volume, bass: audio.bass, mid: audio.mid, treble: audio.treble,
      onset, section,
    };
  },
};
