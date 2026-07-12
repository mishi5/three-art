// #282: Screen 専用出力ウィンドウ ⇄ 親のワープ postMessage プロトコル（純関数）。
// - 子 → 親: { type: WARP_MSG_TYPE, screenId, corner, x, y, phase }（コーナードラッグ）
// - 親 → 子: { type: WARP_STATE_TYPE, screenId, corners: {tlX..brY} }（param 変化の同期）
// 既存の postMessage ブリッジ（#177 "node-vj:cmd"）とは type が異なるため衝突しない。
// e.source の検証（管理中の出力ウィンドウの Window か）は ScreenOutputs.ownsWindow が行う。
import { WARP_MAX, WARP_MIN, type CornerKey } from "./warp-logic";

/** 子 → 親（コーナードラッグ）のメッセージ type。 */
export const WARP_MSG_TYPE = "node-vj:warp";
/** 親 → 子（4 隅 param 状態の同期）のメッセージ type。 */
export const WARP_STATE_TYPE = "node-vj:warp-state";

/** ドラッグの段階。start で 1 回だけ history.record する（ドラッグ 1 回＝undo 1 段）。 */
export type WarpPhase = "start" | "move" | "end";

export interface WarpDragMessage {
  screenId: string;
  corner: CornerKey;
  x: number;
  y: number;
  phase: WarpPhase;
}

const CORNER_KEYS = new Set(["tl", "tr", "bl", "br"]);
const PHASES = new Set(["start", "move", "end"]);

/**
 * 受信 data を検証してドラッグメッセージへ解析する。type 不一致・形不正は null
 * （他ライブラリ/既存ブリッジの postMessage と衝突せず、不正値で params を汚さない）。
 */
export function parseWarpMessage(data: unknown): WarpDragMessage | null {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const d = data as Record<string, unknown>;
  if (d.type !== WARP_MSG_TYPE) return null;
  if (typeof d.screenId !== "string" || d.screenId === "") return null;
  if (typeof d.corner !== "string" || !CORNER_KEYS.has(d.corner)) return null;
  if (typeof d.phase !== "string" || !PHASES.has(d.phase)) return null;
  if (typeof d.x !== "number" || !Number.isFinite(d.x)) return null;
  if (typeof d.y !== "number" || !Number.isFinite(d.y)) return null;
  return { screenId: d.screenId, corner: d.corner as CornerKey, x: d.x, y: d.y, phase: d.phase as WarpPhase };
}

/**
 * ドラッグ値を param へ書ける値にする: min/max（-0.5..1.5）へクランプし、
 * step 相当（0.001）へ丸める。NaN は 0（既定寄りの安全値）。
 */
export function clampWarpValue(v: number): number {
  if (Number.isNaN(v)) return 0;
  const c = Math.max(WARP_MIN, Math.min(WARP_MAX, v));
  return Math.round(c * 1000) / 1000;
}
