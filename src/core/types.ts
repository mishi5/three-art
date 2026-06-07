export type AudioFeatures = {
  /** 全体音量 0..1 */
  volume: number;
  /** 60-250Hz 帯域強度 0..1 */
  bass: number;
  /** 250-2000Hz 帯域強度 0..1 */
  mid: number;
  /** 2-8kHz 帯域強度 0..1 */
  treble: number;
  /** 生 FFT（0..1 正規化、長さ=fftSize/2） */
  fft: Float32Array;
};

export const DEFAULT_AUDIO_FEATURES: AudioFeatures = {
  volume: 0,
  bass: 0,
  mid: 0,
  treble: 0,
  fft: new Float32Array(0),
};

/** 抽出する 13 関節の MediaPipe ランドマーク番号 */
export const JOINT_INDICES = [
  0,  // nose
  11, // left shoulder
  12, // right shoulder
  13, // left elbow
  14, // right elbow
  15, // left wrist
  16, // right wrist
  23, // left hip
  24, // right hip
  25, // left knee
  26, // right knee
  27, // left ankle
  28, // right ankle
] as const;

export const NUM_JOINTS = JOINT_INDICES.length; // 13

/** 13 関節の 3D 位置（メートル単位、シーン座標系） */
export type Joints = Float32Array; // length = NUM_JOINTS * 3

export function makeEmptyJoints(): Joints {
  return new Float32Array(NUM_JOINTS * 3);
}
