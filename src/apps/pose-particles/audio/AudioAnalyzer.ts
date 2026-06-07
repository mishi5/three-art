import type { AudioFeatures } from "../types";

/** Hz を FFT bin index (floor) に変換 */
function hzToBin(hz: number, sampleRate: number, fftSize: number): number {
  return Math.floor((hz / (sampleRate / 2)) * (fftSize / 2));
}

/**
 * 帯域平均を計算する。ビン範囲は inclusive [a, b]。
 * 隣接帯域は上限ビンの +1 を次の帯域の下限とすることで重複なしにする。
 */
function avgBand(
  bins: Uint8Array,
  a: number,
  b: number,
): number {
  const bClamped = Math.min(b, bins.length - 1);
  if (bClamped < a) return 0;
  let sum = 0;
  for (let i = a; i <= bClamped; i++) sum += bins[i] ?? 0;
  return sum / (bClamped - a + 1) / 255; // 0..1
}

export function computeBands(
  bins: Uint8Array,
  sampleRate: number,
  fftSize: number,
): Pick<AudioFeatures, "volume" | "bass" | "mid" | "treble"> {
  // 非重複の帯域 bin 範囲を計算する
  // 上限 Hz は floor() でそのビンに含め、次の帯域はその +1 から始める
  const bassLo = hzToBin(60, sampleRate, fftSize);
  const bassHi = hzToBin(250, sampleRate, fftSize);
  const midLo = bassHi + 1;
  const midHi = hzToBin(2000, sampleRate, fftSize);
  const trebleLo = midHi + 1;
  const trebleHi = hzToBin(8000, sampleRate, fftSize);

  let volSum = 0;
  for (let i = 0; i < bins.length; i++) volSum += bins[i] ?? 0;

  return {
    volume: volSum / bins.length / 255,
    bass: avgBand(bins, bassLo, bassHi),
    mid: avgBand(bins, midLo, midHi),
    treble: avgBand(bins, trebleLo, trebleHi),
  };
}

export class AudioAnalyzer {
  private analyser: AnalyserNode;
  private bins: Uint8Array<ArrayBuffer>;
  private fftBuf: Float32Array<ArrayBuffer>;

  constructor(ctx: AudioContext, fftSize: number = 2048, smoothing: number = 0.7) {
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = fftSize;
    this.analyser.smoothingTimeConstant = smoothing;
    this.bins = new Uint8Array(this.analyser.frequencyBinCount);
    this.fftBuf = new Float32Array(this.analyser.frequencyBinCount);
  }

  /** 入力ノードを analyser に接続する（外部から） */
  get input(): AudioNode {
    return this.analyser;
  }

  read(sampleRate: number): AudioFeatures {
    this.analyser.getByteFrequencyData(this.bins);
    const bands = computeBands(this.bins, sampleRate, this.analyser.fftSize);
    for (let i = 0; i < this.bins.length; i++) {
      this.fftBuf[i] = (this.bins[i] ?? 0) / 255;
    }
    return { ...bands, fft: this.fftBuf };
  }
}
