import type { BandFrame, BandTimeSeries } from "../automation/AnalysisCache";
import { computeBands } from "./AudioAnalyzer";

export interface BinSample {
  t: number;          // 秒
  bins: Uint8Array;   // analyser.getByteFrequencyData の出力
}

export const HOP_MS = 50;
export const FFT_SIZE = 2048;

/**
 * 純粋関数: BinSample 配列 → BandFrame 配列。
 * computeBands は既存 AudioAnalyzer のものをそのまま使い、リアルタイムと
 * オフラインで帯域算出式を一致させる。
 */
export function framesFromBins(
  samples: ReadonlyArray<BinSample>,
  sampleRate: number,
  fftSize: number,
): BandFrame[] {
  return samples.map((s) => {
    const b = computeBands(s.bins, sampleRate, fftSize);
    return { t: s.t, volume: b.volume, bass: b.bass, mid: b.mid, treble: b.treble };
  });
}

/**
 * AudioBuffer を OfflineAudioContext に流して `HOP_MS` ごとに FFT bin を取り出し、
 * 帯域時系列を作る。AnalyserNode の挙動に依存するため Bun テスト不可。手動確認用。
 *
 * 注: AnalyserNode の `getByteFrequencyData` は dB スケール (デフォルト
 * minDecibels=-100 / maxDecibels=-30) で 0..255 を出力する。これらの値が
 * AnalysisCache の payload に焼き込まれるため、デフォルトを変更したら
 * CACHE_VERSION を上げる必要がある。
 */
export async function run(audioBuffer: AudioBuffer): Promise<BandTimeSeries> {
  const sr = audioBuffer.sampleRate;
  const ch = audioBuffer.numberOfChannels;
  const len = audioBuffer.length;
  const offline = new OfflineAudioContext(ch, len, sr);
  const src = offline.createBufferSource();
  src.buffer = audioBuffer;
  const analyser = offline.createAnalyser();
  analyser.fftSize = FFT_SIZE;
  analyser.smoothingTimeConstant = 0.0;
  src.connect(analyser);
  analyser.connect(offline.destination);

  const samples: BinSample[] = [];
  const total = audioBuffer.duration;
  const step = HOP_MS / 1000;

  // OfflineAudioContext.suspend(t) は t 秒で停止し getByteFrequencyData を読める。
  // ループで suspend → 読み取り → resume を繰り返す。
  // .catch を付けて unhandled rejection が rendering を中断しないようにする
  // (suspend は実装によっては render quantum 境界外で reject することがある)。
  for (let t = 0; t < total; t += step) {
    const target = t;
    offline.suspend(target).then(() => {
      const bins = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(bins);
      samples.push({ t: target, bins });
      offline.resume();
    }).catch((err) => { console.warn("[SongAnalyzer] suspend failed at", target, err); });
  }

  src.start(0);
  await offline.startRendering();

  // microtask 順序は仕様上 in-order で push されるはずだが、defensive sort で
  // 万一の順序ズレに備える。framesFromBins は時刻順を期待。
  samples.sort((a, b) => a.t - b.t);

  return {
    duration: total,
    frames: framesFromBins(samples, sr, FFT_SIZE),
    sampleRate: sr,
  };
}
