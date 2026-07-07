// VideoFileInput の fade（映像と音の同時フェード）ロジック（#241）。
// 映像は VideoTextureSurface の乗算色、音は出力 GainNode に同じ値を掛ける。
import type { ParamDef } from "../graph/node-type";

/** fade の既定値（1=フェード無し。既存グラフの見た目/音を変えない）。 */
export const DEFAULT_FADE = 1;

/**
 * 音声フェードの時定数（秒）。gain.gain.setTargetAtTime に渡し、
 * 急変時のクリックノイズを避けつつ、つまみ操作に十分追従する短さにする。
 */
export const FADE_SMOOTH_TIME = 0.03;

/** fade param 定義。数値 param なので入力ポート化され、Envelope/Sine 等から駆動できる。 */
export const FADE_PARAM: ParamDef = {
  id: "fade", label: "fade", kind: "number", default: DEFAULT_FADE, min: 0, max: 1, step: 0.01,
  description: "node.common.video.fade",
};

/** fade 値を 0..1 にクランプする。NaN・非有限は既定 1（従来挙動）に落とす。 */
export function clampFade(v: number): number {
  if (!Number.isFinite(v)) return DEFAULT_FADE;
  return Math.min(1, Math.max(0, v));
}

/**
 * 映像フェードの知覚補正ガンマ。Three.js の色管理では乗算がリニア光空間で行われるが、
 * 人間の明るさ知覚はガンマ的（≈ linear^(1/2.2)）なため、つまみの値をそのまま掛けると
 * 0.3 付近までほとんど暗くならず 0.2 以下で急落して見える（実機確認でのユーザ指摘）。
 */
export const FADE_GAMMA = 2.2;

/**
 * 映像用の知覚リニアな乗算係数。つまみ値 f（0..1）を f^2.2 に変換してから
 * リニア空間で掛けることで、見た目の暗くなり方がつまみに比例する。
 * 端点は保存される（0→0, 1→1）。音声は聴感上比例に感じられるため補正しない。
 */
export function perceptualFade(v: number): number {
  return Math.pow(clampFade(v), FADE_GAMMA);
}

/** ctx.param から fade を読み出す（未設定・不正値は既定 1）。 */
export function readFade(param: (id: string) => unknown): number {
  return clampFade(Number(param("fade") ?? DEFAULT_FADE));
}
