// ノード描画のレイアウト計算（純粋関数）。描画とヒット判定で共有し、整合を保つ。
import type { NodeInstance } from "../graph/graph-doc";
import type { NodeTypeDef } from "../graph/node-type";
import { signalInputs, isParamInput } from "../graph/node-ports";
import { t } from "../i18n";

export const NODE_WIDTH = 168;
export const TITLE_H = 26;
export const ROW_H = 22;
export const PORT_R = 6;
export const PADDING = 8;

/** カテゴリ別のノード背景色（ノード描画・クリップサムネイルで共有）。
 *  #227: 7 カテゴリへ再編。source は旧 input の青・control は旧 generator/process の緑・
 *  render は旧 visual の紫・effect/output は旧色を流用し、audio（琥珀）と composite（青緑）を追加。
 *  未知カテゴリは参照側（NodeEditor/clip-thumbnail）で "#333" にフォールバックする。 */
export const CATEGORY_COLORS: Record<string, string> = {
  source: "#2a4a6a", control: "#3a5a3a", audio: "#5a4a2a", render: "#5a3a5a",
  composite: "#2a5a5a", effect: "#3a4a5a", output: "#5a3a3a",
};

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

/** #150: ノード上にランダム化ボタン行を出すか（randomButton を持つノード）。 */
export function hasRandomRow(def: NodeTypeDef): boolean {
  return !!def.randomButton;
}

/** #205: ノード本体にパッドグリッド（4×4 等）を描くか（padGrid を持つノード）。 */
export function hasPadGrid(def: NodeTypeDef): boolean {
  return !!def.padGrid;
}

/** #205: パッドグリッドのレイアウト定数（ノード内マージン・パッド間ギャップ）。 */
export const PAD_GAP = 4;
export const PAD_MARGIN_X = 8;
export const PAD_MARGIN_TOP = 6;

/** #205: グリッド全体の寸法（パッドサイズはノード幅から算出・正方形）。padGrid 無しは null。 */
export function padGridMetrics(def: NodeTypeDef): {
  rows: number; cols: number; padW: number; padH: number; gap: number; innerW: number;
} | null {
  if (!def.padGrid) return null;
  const { rows, cols } = def.padGrid;
  const innerW = NODE_WIDTH - 2 * PAD_MARGIN_X;
  const padW = (innerW - (cols - 1) * PAD_GAP) / cols;
  return { rows, cols, padW, padH: padW, gap: PAD_GAP, innerW };
}

/** #205: グリッドの高さ（全パッド＋ギャップ）。padGrid 無しは 0。 */
export function padGridHeight(def: NodeTypeDef): number {
  const m = padGridMetrics(def);
  if (!m) return 0;
  return m.rows * m.padH + (m.rows - 1) * m.gap;
}

/** #152: SceneInput のシーン選択行を出すか。 */
export function hasSceneRow(def: NodeTypeDef): boolean {
  return !!def.sceneInput;
}

/** #204: TapSequencer のタップ録音 UI（コントロール行＋ステータス行）を出すか。 */
export function hasTapRows(def: NodeTypeDef): boolean {
  return !!def.tapSequencer;
}

/** #204: TapSequencer が追加する行数（録音/クリアのコントロール行＋ステータス行）。 */
const TAP_ROWS = 2;

/** #186: Automation の記録/再生 UI（シークバー行＋クリア/ステータス行）を出すか。 */
export function hasAutomationRows(def: NodeTypeDef): boolean {
  return !!def.automation;
}

/** #186: Automation が追加する行数（シークバー行＋クリア/ステータス行）。 */
const AUTOMATION_ROWS = 2;

/** #154: ノード UI に行を描く param の数（hidden を除く）。末尾の hidden param 行は詰める。 */
export function visibleParamCount(def: NodeTypeDef): number {
  return def.params.reduce((n, p) => (p.hidden ? n : n + 1), 0);
}

export function nodeHeight(def: NodeTypeDef): number {
  const fileRows = hasFileRow(def) ? FILE_ROWS * ROW_H : 0;
  const randomRow = hasRandomRow(def) ? ROW_H : 0;
  const sceneRow = hasSceneRow(def) ? ROW_H : 0;
  // #205: パッドグリッドは params 直下に上マージン＋グリッド本体ぶん高さを足す。
  const padRows = hasPadGrid(def) ? PAD_MARGIN_TOP + padGridHeight(def) : 0;
  // #204: タップ録音 UI（コントロール行＋ステータス行）。
  const tapRows = hasTapRows(def) ? TAP_ROWS * ROW_H : 0;
  // #186: Automation の記録/再生 UI（シークバー行＋クリア/ステータス行）。
  const automationRows = hasAutomationRows(def) ? AUTOMATION_ROWS * ROW_H : 0;
  return TITLE_H + portRows(def) * ROW_H + visibleParamCount(def) * ROW_H + randomRow + fileRows + sceneRow
    + padRows + tapRows + automationRows + PADDING;
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

/** #208: 出力ポート行に置く倍率チップの寸法。 */
export const SCALE_CHIP_W = 30;
export const SCALE_CHIP_H = 14;

/**
 * #208: number 出力ポートの倍率チップ領域（ノード内・右端寄り、ポート行の右側）。
 * 出力ラベルはこのチップの左へ寄せて重ならないようにする。
 */
export function outputScaleChipRect(node: NodeInstance, idx: number): { x: number; y: number; w: number; h: number } {
  const cy = outputPortPos(node, idx).y;
  const p = nodePos(node);
  return { x: p.x + NODE_WIDTH - SCALE_CHIP_W - 6, y: cy - SCALE_CHIP_H / 2, w: SCALE_CHIP_W, h: SCALE_CHIP_H };
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

/**
 * #150: ランダム化ボタン行の領域（params 直下・randomButton 無しは null）。
 */
export function randomRowRect(
  node: NodeInstance, def: NodeTypeDef,
): { x: number; y: number; w: number; h: number } | null {
  if (!hasRandomRow(def)) return null;
  const p = nodePos(node);
  return { x: p.x, y: p.y + TITLE_H + portRows(def) * ROW_H + visibleParamCount(def) * ROW_H, w: NODE_WIDTH, h: ROW_H };
}

/** #99: ファイル行のラベル。未選択（空/undefined/null）は「ファイル未選択」。 */
export function fileRowLabel(name: string | null | undefined): string {
  return name ? name : t("node.file.none");
}

/**
 * #205: パッドグリッド全体の領域（params 直下・padGrid 無しは null）。
 * グリッドはファイル行/scene 行を持たないノード（MidiPad）の params の下に置く。
 */
export function padGridRect(
  node: NodeInstance, def: NodeTypeDef,
): { x: number; y: number; w: number; h: number } | null {
  const m = padGridMetrics(def);
  if (!m) return null;
  const p = nodePos(node);
  const top = TITLE_H + portRows(def) * ROW_H + visibleParamCount(def) * ROW_H + PAD_MARGIN_TOP;
  return { x: p.x + PAD_MARGIN_X, y: p.y + top, w: m.innerW, h: padGridHeight(def) };
}

/** #205: index（0..rows*cols-1）番目のパッド矩形。row=floor(index/cols), col=index%cols。範囲外/padGrid 無しは null。 */
export function padRect(
  node: NodeInstance, def: NodeTypeDef, index: number,
): { x: number; y: number; w: number; h: number } | null {
  const m = padGridMetrics(def);
  const grid = padGridRect(node, def);
  if (!m || !grid) return null;
  if (index < 0 || index >= m.rows * m.cols) return null;
  const col = index % m.cols;
  const row = Math.floor(index / m.cols);
  return {
    x: grid.x + col * (m.padW + m.gap),
    y: grid.y + row * (m.padH + m.gap),
    w: m.padW,
    h: m.padH,
  };
}

/** #205: world 座標がどのパッドの上か（0..rows*cols-1）。ギャップ/範囲外は null。 */
export function padIndexAt(
  node: NodeInstance, def: NodeTypeDef, worldX: number, worldY: number,
): number | null {
  const m = padGridMetrics(def);
  if (!m) return null;
  for (let i = 0; i < m.rows * m.cols; i++) {
    const r = padRect(node, def, i);
    if (r && worldX >= r.x && worldX <= r.x + r.w && worldY >= r.y && worldY <= r.y + r.h) return i;
  }
  return null;
}

/** #204: タップ録音コントロール行（録音/クリアボタン）の領域（params 直下・tapSequencer 無しは null）。 */
export function tapControlRowRect(
  node: NodeInstance, def: NodeTypeDef,
): { x: number; y: number; w: number; h: number } | null {
  if (!hasTapRows(def)) return null;
  const p = nodePos(node);
  return { x: p.x, y: p.y + TITLE_H + portRows(def) * ROW_H + visibleParamCount(def) * ROW_H, w: NODE_WIDTH, h: ROW_H };
}

/** #204: タップ録音ステータス行（記録数/ループ長/再生位置）の領域（コントロール行の直下）。 */
export function tapStatusRowRect(
  node: NodeInstance, def: NodeTypeDef,
): { x: number; y: number; w: number; h: number } | null {
  const cr = tapControlRowRect(node, def);
  if (!cr) return null;
  return { x: cr.x, y: cr.y + ROW_H, w: cr.w, h: ROW_H };
}

/** #204: コントロール行を「● 録音（ホールド）」と「✕ クリア」の 2 ボタンに分割する。 */
export function tapControlLayout(rect: { x: number; y: number; w: number; h: number }): {
  rec: { x: number; y: number; w: number; h: number };
  clear: { x: number; y: number; w: number; h: number };
} {
  const pad = 6, gap = 6;
  const inner = rect.w - 2 * pad;
  const recW = Math.round(inner * 0.56); // 録音を広め（主操作）
  const rec = { x: rect.x + pad, y: rect.y + 2, w: recW, h: rect.h - 4 };
  const clear = { x: rec.x + recW + gap, y: rect.y + 2, w: inner - recW - gap, h: rect.h - 4 };
  return { rec, clear };
}

/**
 * #204: ステータス行のラベル。recording は打数＋経過秒、playing は打数/ループ長＋再生位置、
 * それ以外（idle・state 未生成）は「記録なし」。
 */
export function tapStatusLabel(
  s: { phase: string; tapCount: number; loopLenSec: number; playPosSec: number; recordElapsedSec: number } | null | undefined,
): string {
  if (!s) return t("node.tap.none");
  if (s.phase === "recording") return t("node.tap.recording", { n: s.tapCount, sec: s.recordElapsedSec.toFixed(1) });
  if (s.phase === "playing") {
    return t("node.tap.playing", { n: s.tapCount, len: s.loopLenSec.toFixed(1), pos: s.playPosSec.toFixed(1) });
  }
  return t("node.tap.none");
}

/** #186: Automation のシークバー行の領域（params 直下・automation 無しは null）。 */
export function automationSeekRowRect(
  node: NodeInstance, def: NodeTypeDef,
): { x: number; y: number; w: number; h: number } | null {
  if (!hasAutomationRows(def)) return null;
  const p = nodePos(node);
  return { x: p.x, y: p.y + TITLE_H + portRows(def) * ROW_H + visibleParamCount(def) * ROW_H, w: NODE_WIDTH, h: ROW_H };
}

/** #186: Automation のクリアボタン＋ステータス行の領域（シークバー行の直下）。 */
export function automationControlRowRect(
  node: NodeInstance, def: NodeTypeDef,
): { x: number; y: number; w: number; h: number } | null {
  const sr = automationSeekRowRect(node, def);
  if (!sr) return null;
  return { x: sr.x, y: sr.y + ROW_H, w: sr.w, h: ROW_H };
}

/** #186: コントロール行を「✕ クリア」ボタンとステータス表示に分割する（#204 tapControlLayout と同型）。 */
export function automationControlLayout(rect: { x: number; y: number; w: number; h: number }): {
  clear: { x: number; y: number; w: number; h: number };
  status: { x: number; y: number; w: number; h: number };
} {
  const pad = 6, gap = 6, clearW = 54;
  const clear = { x: rect.x + pad, y: rect.y + 2, w: clearW, h: rect.h - 4 };
  const status = { x: clear.x + clearW + gap, y: rect.y + 2, w: rect.w - 2 * pad - clearW - gap, h: rect.h - 4 };
  return { clear, status };
}

/**
 * #186: シークバー領域内の world x 座標から再生位置の fraction（0..1・クランプ済み）を算出する
 * 純関数。rect.w<=0（不正なレイアウト）は 0。
 */
export function automationSeekFraction(
  rect: { x: number; w: number }, worldX: number,
): number {
  if (!(rect.w > 0)) return 0;
  const ratio = (worldX - rect.x) / rect.w;
  return Math.max(0, Math.min(1, ratio));
}

/**
 * #186: ステータス行のラベル。recording は記録点数＋経過秒、playing はループ長＋再生位置、
 * それ以外（idle・state 未生成）は「記録なし」。
 */
export function automationStatusLabel(
  s: { phase: string; frameCount: number; loopLenSec: number; playPosSec: number; recordElapsedSec: number } | null | undefined,
): string {
  if (!s) return t("node.automation.none");
  if (s.phase === "recording") {
    return t("node.automation.recording", { n: s.frameCount, sec: s.recordElapsedSec.toFixed(1) });
  }
  if (s.phase === "playing") {
    return t("node.automation.playing", { len: s.loopLenSec.toFixed(1), pos: s.playPosSec.toFixed(1) });
  }
  return t("node.automation.none");
}

/** #152: シーン選択行の領域（params 直下・sceneInput 無しは null）。 */
export function sceneRowRect(
  node: NodeInstance, def: NodeTypeDef,
): { x: number; y: number; w: number; h: number } | null {
  if (!hasSceneRow(def)) return null;
  const p = nodePos(node);
  return { x: p.x, y: p.y + TITLE_H + portRows(def) * ROW_H + visibleParamCount(def) * ROW_H, w: NODE_WIDTH, h: ROW_H };
}

/** #152: シーン選択行のラベル。未選択は「(シーン未選択)」。 */
export function sceneRowLabel(name: string | null | undefined): string {
  return name ? name : t("node.scene.none");
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

/** #205: MidiPad タイトルバー右端の「拡大表示」ボタン領域（⛶）。 */
export function padExpandButtonRect(node: NodeInstance): { x: number; y: number; w: number; h: number } {
  const p = nodePos(node);
  return { x: p.x + NODE_WIDTH - 22, y: p.y + 4, w: 18, h: TITLE_H - 8 };
}

/** #205: 拡大ボタンの左隣に置く「全停止（Stop）」ボタン領域（■）。 */
export function padStopButtonRect(node: NodeInstance): { x: number; y: number; w: number; h: number } {
  const p = nodePos(node);
  return { x: p.x + NODE_WIDTH - 42, y: p.y + 4, w: 18, h: TITLE_H - 8 };
}

/** プレビュー小窓の表示領域。右横はポート列・配線と重なるためノードの上側に置く。 */
export { PREVIEW_W, PREVIEW_H } from "../graph/preview";
import { PREVIEW_W, PREVIEW_H } from "../graph/preview";
export function previewWindowRect(node: NodeInstance): { x: number; y: number; w: number; h: number } {
  const p = nodePos(node);
  return { x: p.x, y: p.y - PREVIEW_H - 8, w: PREVIEW_W, h: PREVIEW_H };
}
