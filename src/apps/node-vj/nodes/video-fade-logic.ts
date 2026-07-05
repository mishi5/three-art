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
  description: "映像と音の同時フェード（0=黒＋無音、1=そのまま）。他ノードの number 出力で駆動可能。",
};

/** fade 値を 0..1 にクランプする。NaN・非有限は既定 1（従来挙動）に落とす。 */
export function clampFade(v: number): number {
  if (!Number.isFinite(v)) return DEFAULT_FADE;
  return Math.min(1, Math.max(0, v));
}

/** ctx.param から fade を読み出す（未設定・不正値は既定 1）。 */
export function readFade(param: (id: string) => unknown): number {
  return clampFade(Number(param("fade") ?? DEFAULT_FADE));
}
