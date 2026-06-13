// ノード描画のレイアウト計算（純粋関数）。描画とヒット判定で共有し、整合を保つ。
import type { NodeInstance } from "../graph/graph-doc";
import type { NodeTypeDef } from "../graph/node-type";
import { signalInputs, isParamInput } from "../graph/node-ports";

export const NODE_WIDTH = 168;
export const TITLE_H = 26;
export const ROW_H = 22;
export const PORT_R = 6;
export const PADDING = 8;

// 上部の行数 = signal 入力（左）と出力（右）の多い方。数値 param は param 行のドットで接続する。
export function portRows(def: NodeTypeDef): number {
  return Math.max(signalInputs(def).length, def.outputs.length);
}

/** #99: ノード上にファイル選択行を出すか（fileInput を持つノード）。 */
export function hasFileRow(def: NodeTypeDef): boolean {
  return !!def.fileInput;
}

/** fileInput 持ちノードが追加する行数（file 選択行＋transport 行）。 */
const FILE_ROWS = 2;

export function nodeHeight(def: NodeTypeDef): number {
  const fileRows = hasFileRow(def) ? FILE_ROWS * ROW_H : 0;
  return TITLE_H + portRows(def) * ROW_H + def.params.length * ROW_H + fileRows + PADDING;
}

export function nodePos(node: NodeInstance): { x: number; y: number } {
  return { x: node.position?.x ?? 0, y: node.position?.y ?? 0 };
}

export function nodeRect(node: NodeInstance, def: NodeTypeDef): {
  x: number; y: number; w: number; h: number;
} {
  const p = nodePos(node);
  return { x: p.x, y: p.y, w: NODE_WIDTH, h: nodeHeight(def) };
}

/** 入力ポート（左辺）の中心座標。 */
export function inputPortPos(node: NodeInstance, idx: number): { x: number; y: number } {
  const p = nodePos(node);
  return { x: p.x, y: p.y + TITLE_H + idx * ROW_H + ROW_H / 2 };
}

/** 出力ポート（右辺）の中心座標。 */
export function outputPortPos(node: NodeInstance, idx: number): { x: number; y: number } {
  const p = nodePos(node);
  return { x: p.x + NODE_WIDTH, y: p.y + TITLE_H + idx * ROW_H + ROW_H / 2 };
}

/** param 行の y 中心（行クリック判定用）。 */
export function paramRowY(node: NodeInstance, def: NodeTypeDef, i: number): number {
  const p = nodePos(node);
  return p.y + TITLE_H + portRows(def) * ROW_H + i * ROW_H + ROW_H / 2;
}

export function portIndex(def: NodeTypeDef, kind: "input" | "output", portId: string): number {
  const list = kind === "input" ? def.inputs : def.outputs;
  return list.findIndex((p) => p.id === portId);
}

/** param 行の左辺ドット（数値 param の接続点）の中心座標。 */
export function paramPortPos(node: NodeInstance, def: NodeTypeDef, paramIndex: number): { x: number; y: number } {
  return { x: nodePos(node).x, y: paramRowY(node, def, paramIndex) };
}

/**
 * 入力ポート id の座標を解決する。signal 入力は上部行、数値 param は param 行ドット。
 * 未知 id は null。
 */
export function resolveInputPortPos(
  node: NodeInstance, def: NodeTypeDef, portId: string,
): { x: number; y: number } | null {
  const sig = signalInputs(def);
  const sigIdx = sig.findIndex((p) => p.id === portId);
  if (sigIdx >= 0) return inputPortPos(node, sigIdx);
  if (isParamInput(def, portId)) {
    const pidx = def.params.findIndex((p) => p.id === portId);
    if (pidx >= 0) return paramPortPos(node, def, pidx);
  }
  return null;
}

/**
 * #99: ファイル選択行のクリック領域。ノード下端 2 行のうち上側（fileInput 無しは null）。
 */
export function fileRowRect(
  node: NodeInstance, def: NodeTypeDef,
): { x: number; y: number; w: number; h: number } | null {
  if (!hasFileRow(def)) return null;
  const p = nodePos(node);
  return { x: p.x, y: p.y + nodeHeight(def) - 2 * ROW_H, w: NODE_WIDTH, h: ROW_H };
}

/**
 * #99: 再生コントロール（transport）行の領域。ノード最下行（fileInput 無しは null）。
 */
export function transportRowRect(
  node: NodeInstance, def: NodeTypeDef,
): { x: number; y: number; w: number; h: number } | null {
  if (!hasFileRow(def)) return null;
  const p = nodePos(node);
  return { x: p.x, y: p.y + nodeHeight(def) - ROW_H, w: NODE_WIDTH, h: ROW_H };
}

/** #99: ファイル行のラベル。未選択（空/undefined/null）は「ファイル未選択」。 */
export function fileRowLabel(name: string | null | undefined): string {
  return name ? name : "ファイル未選択";
}

/** transport 行を再生ボタンとシークバーに分割する（時刻表示ぶんを右に確保）。 */
export function transportLayout(rect: { x: number; y: number; w: number; h: number }): {
  button: { x: number; y: number; w: number; h: number };
  seek: { x: number; y: number; w: number; h: number };
} {
  const pad = 6;
  const timeW = 34;
  const button = { x: rect.x + pad, y: rect.y + 3, w: 18, h: rect.h - 6 };
  const seekX = button.x + button.w + 6;
  const seekRight = rect.x + rect.w - pad - timeW;
  const seek = {
    x: seekX, y: rect.y + rect.h / 2 - 3,
    w: Math.max(10, seekRight - seekX), h: 6,
  };
  return { button, seek };
}

/** シークバー上の x 座標 → 再生位置比 0..1（範囲外はクランプ）。 */
export function seekRatioAt(x: number, seek: { x: number; w: number }): number {
  if (seek.w <= 0) return 0;
  const r = (x - seek.x) / seek.w;
  return r < 0 ? 0 : r > 1 ? 1 : r;
}

/** 秒を m:ss に整形。非有限/負は 0:00。 */
export function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx, dy = ay - by;
  return dx * dx + dy * dy;
}

/** タイトルバー右端のプレビュートグルボタン領域（#77）。 */
export function previewButtonRect(node: NodeInstance): { x: number; y: number; w: number; h: number } {
  const p = nodePos(node);
  return { x: p.x + NODE_WIDTH - 22, y: p.y + 4, w: 18, h: TITLE_H - 8 };
}

/** プレビュー小窓の表示領域。右横はポート列・配線と重なるためノードの上側に置く。 */
export { PREVIEW_W, PREVIEW_H } from "../graph/preview";
import { PREVIEW_W, PREVIEW_H } from "../graph/preview";
export function previewWindowRect(node: NodeInstance): { x: number; y: number; w: number; h: number } {
  const p = nodePos(node);
  return { x: p.x, y: p.y - PREVIEW_H - 8, w: PREVIEW_W, h: PREVIEW_H };
}
