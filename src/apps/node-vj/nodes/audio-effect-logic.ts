// #239: 音声エフェクトノード（AudioFilter/AudioGain/AudioReverb）の純粋ロジック。
// AudioContext に依存しない部分（param 検証・IR 波形生成・AudioParam 平滑化の判定）を
// 切り出してテスト可能にする。

/** AudioParam 追従（setTargetAtTime）の時定数（秒）。クリックノイズを避けつつ十分速い値。 */
export const SMOOTH_TIME_CONSTANT = 0.03;

/** AudioFilter で選べるフィルタ種別。 */
export const FILTER_TYPES = ["lowpass", "highpass", "bandpass"] as const;
export type FilterType = (typeof FILTER_TYPES)[number];

/** unknown を数値 param として読む（非数は fallback・範囲外はクランプ）。 */
export function readNumberParam(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** unknown をフィルタ種別として読む（未知値は lowpass にフォールバック）。 */
export function readFilterType(v: unknown): FilterType {
  return (FILTER_TYPES as readonly unknown[]).includes(v) ? (v as FilterType) : "lowpass";
}

/** setTargetAtTime を受けられる最小の AudioParam 型（テストでモック差し替え可能に）。 */
export interface SmoothableParam {
  setTargetAtTime(value: number, startTime: number, timeConstant: number): unknown;
}

/**
 * AudioParam を目標値へ滑らかに追従させる（クリックノイズ回避）。
 * 前回適用値（last）と同じ値なら何もしない（automation イベントを毎フレーム積まない）。
 * 戻り値を呼び出し側 state の「前回適用値」として保存すること。
 */
export function applySmoothParam(
  ap: SmoothableParam,
  last: number | null,
  value: number,
  now: number,
  timeConstant: number = SMOOTH_TIME_CONSTANT,
): number {
  if (last !== null && last === value) return last;
  ap.setTargetAtTime(value, now, timeConstant);
  return value;
}

/** リバーブ decay（IR 長・秒）の範囲。 */
export const REVERB_DECAY_MIN = 0.1;
export const REVERB_DECAY_MAX = 8;

/** IR 再生成を判断する decay 変化のしきい値（秒）。number 駆動の微小揺れで毎フレーム再生成しないためのガード。 */
export const REVERB_REGEN_EPSILON = 0.01;

/**
 * リバーブ用インパルス応答（IR）の波形をチャンネルごとに生成する（外部ファイル不要）。
 * ホワイトノイズに減衰カーブ (1 - t/T)^2.5 を掛けた素朴な IR。チャンネルごとに独立した
 * ノイズを使いステレオの広がりを出す。rng は注入可能（テストの決定性用）。
 */
export function buildImpulseResponse(
  sampleRate: number,
  decaySec: number,
  channels = 2,
  rng: () => number = Math.random,
): Float32Array<ArrayBuffer>[] {
  const sec = Math.min(REVERB_DECAY_MAX, Math.max(REVERB_DECAY_MIN, decaySec));
  const length = Math.max(1, Math.round(sampleRate * sec));
  const out: Float32Array<ArrayBuffer>[] = [];
  for (let c = 0; c < channels; c++) {
    const data = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      data[i] = (rng() * 2 - 1) * Math.pow(1 - i / length, 2.5);
    }
    out.push(data);
  }
  return out;
}
