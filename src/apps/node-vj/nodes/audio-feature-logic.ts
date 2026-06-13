// 音声入力ノード共通の音響特徴量ロジック（#100）。
// MicInput / DisplayAudioInput / AudioFileInput で重複する出力ポート定義・onset 検出・
// ライブ音源ランタイムをここに集約する。
import type { AudioInput } from "../../../core/audio/AudioInput";
import { OnsetDetector } from "../../../core/audio/OnsetDetector";
import { DEFAULT_AUDIO_FEATURES, type AudioFeatures } from "../../../core/types";
import type { PortDef } from "../graph/node-type";

export const ONSET_THRESHOLD = 0.12;
export const ONSET_COOLDOWN = 0.12;

/** 音声入力ノード共通の出力ポート（audio / 各バンド / onset）。section は含まない。 */
export const AUDIO_FEATURE_OUTPUTS: PortDef[] = [
  { id: "audio", label: "audio", type: "audio" },
  { id: "volume", label: "volume", type: "number" },
  { id: "bass", label: "bass", type: "number" },
  { id: "mid", label: "mid", type: "number" },
  { id: "treble", label: "treble", type: "number" },
  { id: "onset", label: "onset", type: "trigger" },
];

/** AudioFeatures と onset から共通出力オブジェクトを組み立てる。 */
export function audioFeatureOutputs(audio: AudioFeatures, onset: boolean): Record<string, unknown> {
  return {
    audio,
    volume: audio.volume, bass: audio.bass, mid: audio.mid, treble: audio.treble,
    onset,
  };
}

/**
 * onset 検出ラッパ。`detect` はこのフレームで新規 onset が発火したかを返す（#107）。
 * OnsetDetector の直近 onset 時刻が前フレームより進んだフレームのみ true。
 * 無音・定常時は false（初回フレームも -Infinity 比較で誤発火しない）。
 */
export class OnsetTracker {
  private onset = new OnsetDetector();
  private prevOnsetTime = -Infinity;

  detect(bass: number, t: number): boolean {
    this.onset.update(bass, ONSET_THRESHOLD, ONSET_COOLDOWN, t);
    const last = this.onset.getLastOnsetTime();
    const fired = last > this.prevOnsetTime;
    this.prevOnsetTime = last;
    return fired;
  }
}

/**
 * ライブ音源（マイク / 画面音声）共通の永続状態。
 * `start()`（user gesture）で `createSource` の音源を起動して特徴量を供給する。
 * section は持たない（ファイル専用）。
 */
export abstract class LiveAudioRuntime {
  source: AudioInput | null = null;
  started = false;
  protected ctx: AudioContext | null = null;
  private onset = new OnsetTracker();

  protected getCtx(): AudioContext {
    return (this.ctx ??= new AudioContext());
  }

  /** サブクラスが具体的な音源（Mic/Display）を生成する。 */
  protected abstract createSource(ctx: AudioContext): AudioInput;

  async start(): Promise<void> {
    const src = this.createSource(this.getCtx());
    await src.start();
    this.source = src;
    this.started = true;
  }

  read(): AudioFeatures {
    return this.source?.read() ?? DEFAULT_AUDIO_FEATURES;
  }

  detectOnset(bass: number, t: number): boolean {
    return this.onset.detect(bass, t);
  }

  dispose(): void {
    this.source?.stop();
  }
}
