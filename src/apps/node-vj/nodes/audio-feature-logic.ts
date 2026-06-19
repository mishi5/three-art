// 音声入力ノード共通の音響特徴量ロジック（#100）。
// MicInput / DisplayAudioInput / AudioFileInput で重複する出力ポート定義・onset 検出・
// ライブ音源ランタイムをここに集約する。
import type { AudioInput } from "../../../core/audio/AudioInput";
import { DEFAULT_AUDIO_FEATURES, type AudioFeatures } from "../../../core/types";
import type { ParamDef, PortDef } from "../graph/node-type";

/** onset 判定の既定値（#109）。しきい値は感度向上のため 0.12→0.06 に引き下げ。 */
export const DEFAULT_ONSET_THRESHOLD = 0.06;
export const DEFAULT_ONSET_COOLDOWN = 0.12;

/** audio 入力ノード共通の onset 調整 param（#109）。3 ノードで共有する。 */
export const ONSET_PARAMS: ParamDef[] = [
  { id: "onsetThreshold", label: "onsetThr", kind: "number", default: DEFAULT_ONSET_THRESHOLD, min: 0, max: 0.5, step: 0.005 },
  { id: "onsetCooldown", label: "onsetCD", kind: "number", default: DEFAULT_ONSET_COOLDOWN, min: 0, max: 1, step: 0.01 },
];

/** 音声入力ノード共通の出力ポート（audio / 各バンド / onset）。section は含まない。 */
export const AUDIO_FEATURE_OUTPUTS: PortDef[] = [
  { id: "audio", label: "audio", type: "audio" },
  { id: "volume", label: "volume", type: "number" },
  { id: "bass", label: "bass", type: "number" },
  { id: "mid", label: "mid", type: "number" },
  { id: "treble", label: "treble", type: "number" },
  { id: "onset", label: "onset", type: "trigger" },
];

/** ctx.param から onset しきい値/cooldown を読み出す（未設定は既定値）。 */
export function readOnsetParams(param: (id: string) => unknown): { threshold: number; cooldown: number } {
  return {
    threshold: Number(param("onsetThreshold") ?? DEFAULT_ONSET_THRESHOLD),
    cooldown: Number(param("onsetCooldown") ?? DEFAULT_ONSET_COOLDOWN),
  };
}

/** AudioFeatures と onset から共通出力オブジェクトを組み立てる。 */
export function audioFeatureOutputs(audio: AudioFeatures, onset: boolean): Record<string, unknown> {
  return {
    audio,
    volume: audio.volume, bass: audio.bass, mid: audio.mid, treble: audio.treble,
    onset,
  };
}

/**
 * onset 検出（#107/#109）。bass の前フレーム差が threshold を超え、cooldown 経過していれば発火。
 * threshold/cooldown は呼び出し側（ノード param）から渡す。初回は prime して起動直後の誤発火を防ぐ。
 * 同じ bass を保持中は delta=0 なので再発火しない（拍ごとに 1 回）。
 * 注: 平滑化は検討したが、平滑値が登り続けて保持中に再発火する副作用があるため生 delta を採用。
 */
export class OnsetTracker {
  private prevBass = 0;
  private lastOnset = -Infinity;
  private primed = false;

  detect(bass: number, t: number, threshold: number, cooldown: number): boolean {
    if (!this.primed) { this.prevBass = bass; this.primed = true; return false; }
    const delta = bass - this.prevBass;
    this.prevBass = bass;
    if (delta > threshold && t - this.lastOnset > cooldown) {
      this.lastOnset = t;
      return true;
    }
    return false;
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

  detectOnset(bass: number, t: number, threshold: number, cooldown: number): boolean {
    return this.onset.detect(bass, t, threshold, cooldown);
  }

  dispose(): void {
    this.source?.stop();
  }
}
