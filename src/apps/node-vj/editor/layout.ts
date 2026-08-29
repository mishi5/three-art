// ノード描画のレイアウト計算（純粋関数）。描画とヒット判定で共有し、整合を保つ。
import type { NodeInstance } from "../graph/graph-doc";
import type { NodeTypeDef } from "../graph/node-type";
import { signalInputs, isParamInput } from "../graph/node-ports";
import { t } from "../i18n";
import type { MidiLearnDisplay } from "../nodes/midi-node-logic";

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

/** #281: パッド割当ファイルダイアログの accept（省略時 "audio/*"＝SamplePad 従来動作）。 */
export function padGridAccept(def: NodeTypeDef): string {
  return def.padGrid?.accept ?? "audio/*";
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

/** #204/#278: TapSequencer のタップ録音 UI（シークバー行＋コントロール行）を出すか。 */
export function hasTapRows(def: NodeTypeDef): boolean {
  return !!def.tapSequencer;
}

/** #204/#278: TapSequencer が追加する行数（シークバー行＋停止/再生・クリア・ステータスのコントロール行）。 */
const TAP_ROWS = 2;

/** #186: Automation の記録/再生 UI（シークバー行＋コントロール行）を出すか。 */
export function hasAutomationRows(def: NodeTypeDef): boolean {
  return !!def.automation;
}

/** #186/#278: Automation が追加する行数（シークバー行＋停止/再生・クリア・ステータスのコントロール行）。 */
const AUTOMATION_ROWS = 2;

/** #270: BeatClock のビートクロック UI（TAP ボタン＋ BPM ステータス行）を出すか。 */
export function hasBeatClockRow(def: NodeTypeDef): boolean {
  return !!def.beatClock;
}

/** #270: BeatClock が追加する行数（TAP ボタン＋ステータスの 1 行）。 */
const BEATCLOCK_ROWS = 1;

/** #272: MIDI Learn 行（LEARN ボタン＋割当ステータス）を出すか。 */
export function hasMidiLearnRow(def: NodeTypeDef): boolean {
  return !!def.midiLearn;
}

/** #272: MIDI Learn が追加する行数（LEARN ボタン＋ステータスの 1 行）。 */
const MIDI_LEARN_ROWS = 1;

/** #272: MIDI パッドの押下インジケータ（rows×cols）を出すか。 */
export function hasMidiPadGrid(def: NodeTypeDef): boolean {
  return !!def.midiPad;
}

/** #282: Screen の「⧉ 出力」トグル行（専用出力ウィンドウの開閉）を出すか。 */
export function hasScreenOutputRow(def: NodeTypeDef): boolean {
  return !!def.screenOutput;
}

/** #282: Screen 出力トグルが追加する行数（トグルボタン＋状態ラベルの 1 行）。 */
const SCREEN_OUTPUT_ROWS = 1;

/** #154: ノード UI に行を描く param の数（hidden を除く）。#293: hidden はどの位置にあっても詰める。 */
export function visibleParamCount(def: NodeTypeDef): number {
  return def.params.reduce((n, p) => (p.hidden ? n : n + 1), 0);
}

export function nodeHeight(def: NodeTypeDef): number {
  const fileRows = hasFileRow(def) ? FILE_ROWS * ROW_H : 0;
  // #281: transport 単体（fileInput なし・ClipLauncher）はトランスポート行 1 行ぶんだけ足す
  // （fileInput 持ちは FILE_ROWS にトランスポート行が含まれている）。
  const transportRow = !hasFileRow(def) && hasTransportRow(def) ? ROW_H : 0;
  const randomRow = hasRandomRow(def) ? ROW_H : 0;
  const sceneRow = hasSceneRow(def) ? ROW_H : 0;
  // #205: パッドグリッドは params 直下に上マージン＋グリッド本体ぶん高さを足す。
  const padRows = hasPadGrid(def) ? PAD_MARGIN_TOP + padGridHeight(def) : 0;
  // #204: タップ録音 UI（コントロール行＋ステータス行）。
  const tapRows = hasTapRows(def) ? TAP_ROWS * ROW_H : 0;
  // #186: Automation の記録/再生 UI（シークバー行＋クリア/ステータス行）。
  const automationRows = hasAutomationRows(def) ? AUTOMATION_ROWS * ROW_H : 0;
  // #270: BeatClock のビートクロック UI（TAP ボタン＋ステータス行）。
  const beatClockRows = hasBeatClockRow(def) ? BEATCLOCK_ROWS * ROW_H : 0;
  // #282: Screen の「⧉ 出力」トグル行。
  const screenOutputRows = hasScreenOutputRow(def) ? SCREEN_OUTPUT_ROWS * ROW_H : 0;
  // #272: MIDI Learn 行と、その下に来る MidiPad の押下インジケータ。
  const midiLearnRows = hasMidiLearnRow(def) ? MIDI_LEARN_ROWS * ROW_H : 0;
  const midiPadRows = hasMidiPadGrid(def) ? PAD_MARGIN_TOP + midiPadGridHeight(def) : 0;
  return TITLE_H + portRows(def) * ROW_H + visibleParamCount(def) * ROW_H + randomRow + fileRows + transportRow
    + sceneRow + padRows + tapRows + automationRows + beatClockRows + screenOutputRows
    + midiLearnRows + midiPadRows + PADDING;
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
/**
 * #293: params[i] が上から何行目に描かれるか（hidden を詰めた行番号）。
 * hidden param は行を持たないので、それより後ろの param は詰めて並ぶ。
 * hidden 自身を渡すと「次の表示 param と同じ行」を返すが、呼び出し側は
 * いずれも hidden を除外してから呼ぶので実害はない。
 */
export function visibleParamRow(def: NodeTypeDef, i: number): number {
  let row = 0;
  for (let k = 0; k < i && k < def.params.length; k++) {
    if (!def.params[k]!.hidden) row += 1;
  }
  return row;
}

/**
 * params[i] の行の中心 y。
 * #293: 絶対 index ではなく **hidden を詰めた行番号**で計算する。絶対 index で数えると、
 * hidden が末尾以外にあるノード（SceneInput の sceneId）で表示 param が 1 行ずつ下へずれ、
 * param 行の下に来る行（シーン行など・visibleParamCount 基準）と重なってしまう。
 * 重なると hitTest が param を先に返し、シーン行のクリックがスライダのドラッグに食われる。
 */
export function paramRowY(node: NodeInstance, def: NodeTypeDef, i: number): number {
  const p = nodePos(node);
  return p.y + TITLE_H + portRows(def) * ROW_H + visibleParamRow(def, i) * ROW_H + ROW_H / 2;
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
 * #99/#281: トランスポート行（再生/一時停止＋シークバー）を出すか。
 * fileInput 持ち（従来）に加え、transport フラグ単体（ClipLauncher）でも出す。
 */
export function hasTransportRow(def: NodeTypeDef): boolean {
  return hasFileRow(def) || !!def.transport;
}

/**
 * #99: 再生コントロール（transport）行の領域。ノード最下行（fileInput/transport 無しは null）。
 */
export function transportRowRect(
  node: NodeInstance, def: NodeTypeDef,
): { x: number; y: number; w: number; h: number } | null {
  if (!hasTransportRow(def)) return null;
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
 * グリッドはファイル行/scene 行を持たないノード（SamplePad）の params の下に置く。
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

/**
 * #278: タップ録音シークバー行の領域（params 直下・tapSequencer 無しは null）。
 * automationSeekRowRect と同型（Automation・TapSequencer でレイアウトを統一）。
 */
export function tapSeekRowRect(
  node: NodeInstance, def: NodeTypeDef,
): { x: number; y: number; w: number; h: number } | null {
  if (!hasTapRows(def)) return null;
  const p = nodePos(node);
  return { x: p.x, y: p.y + TITLE_H + portRows(def) * ROW_H + visibleParamCount(def) * ROW_H, w: NODE_WIDTH, h: ROW_H };
}

/**
 * #204/#278: タップ録音コントロール行（停止/再生・クリアボタン・ステータス表示）の領域
 * （シークバー行の直下。#278 でステータス行を統合し、Automation と同じ 2 行構成にした）。
 */
export function tapControlRowRect(
  node: NodeInstance, def: NodeTypeDef,
): { x: number; y: number; w: number; h: number } | null {
  const sr = tapSeekRowRect(node, def);
  if (!sr) return null;
  return { x: sr.x, y: sr.y + ROW_H, w: sr.w, h: ROW_H };
}

/**
 * #278: コントロール行を「停止/再生」「✕ クリア」「ステータス表示」の 3 分割にする共有 helper。
 * automationControlLayout/tapControlLayout の中身が完全に同一の計算になるため、重複を避けて
 * ここに 1 つだけ定義する（呼び出し側のエクスポート名・シグネチャは維持）。
 */
function loopControlLayout(rect: { x: number; y: number; w: number; h: number }): {
  stopPlay: { x: number; y: number; w: number; h: number };
  clear: { x: number; y: number; w: number; h: number };
  status: { x: number; y: number; w: number; h: number };
} {
  const pad = 6, gap = 6, stopW = 28, clearW = 54;
  const stopPlay = { x: rect.x + pad, y: rect.y + 2, w: stopW, h: rect.h - 4 };
  const clear = { x: stopPlay.x + stopW + gap, y: rect.y + 2, w: clearW, h: rect.h - 4 };
  const status = {
    x: clear.x + clearW + gap, y: rect.y + 2,
    w: rect.w - 2 * pad - stopW - clearW - 2 * gap, h: rect.h - 4,
  };
  return { stopPlay, clear, status };
}

/**
 * #275/#278: コントロール行のレイアウト（停止/再生ボタン・「✕ クリア」ボタン・ステータス表示の 3 分割）。
 * automationControlLayout と完全に同じ形（loopControlLayout を共有）。
 */
export function tapControlLayout(rect: { x: number; y: number; w: number; h: number }): {
  stopPlay: { x: number; y: number; w: number; h: number };
  clear: { x: number; y: number; w: number; h: number };
  status: { x: number; y: number; w: number; h: number };
} {
  return loopControlLayout(rect);
}

/**
 * #204/#278: ステータス行のラベル。recording は打数＋経過秒、playing は打数/ループ長＋再生位置、
 * stopped は playing と同内容に停止であることが分かる接頭辞を付けたもの、それ以外
 * （idle・state 未生成）は「記録なし」。
 */
export function tapStatusLabel(
  s: { phase: string; tapCount: number; loopLenSec: number; playPosSec: number; recordElapsedSec: number } | null | undefined,
): string {
  if (!s) return t("node.tap.none");
  if (s.phase === "recording") return t("node.tap.recording", { n: s.tapCount, sec: s.recordElapsedSec.toFixed(1) });
  if (s.phase === "playing") {
    return t("node.tap.playing", { n: s.tapCount, len: s.loopLenSec.toFixed(1), pos: s.playPosSec.toFixed(1) });
  }
  if (s.phase === "stopped") {
    return t("node.tap.stopped", { n: s.tapCount, len: s.loopLenSec.toFixed(1), pos: s.playPosSec.toFixed(1) });
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

/** #186: Automation のコントロール行（停止/再生・クリアボタン・ステータス表示）の領域（シークバー行の直下）。 */
export function automationControlRowRect(
  node: NodeInstance, def: NodeTypeDef,
): { x: number; y: number; w: number; h: number } | null {
  const sr = automationSeekRowRect(node, def);
  if (!sr) return null;
  return { x: sr.x, y: sr.y + ROW_H, w: sr.w, h: ROW_H };
}

/**
 * #186/#278: コントロール行を「停止/再生」「✕ クリア」「ステータス表示」の 3 分割にする
 * （#204/#278 tapControlLayout と完全に同じ形・loopControlLayout を共有）。
 */
export function automationControlLayout(rect: { x: number; y: number; w: number; h: number }): {
  stopPlay: { x: number; y: number; w: number; h: number };
  clear: { x: number; y: number; w: number; h: number };
  status: { x: number; y: number; w: number; h: number };
} {
  return loopControlLayout(rect);
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
 * #186/#278: ステータス行のラベル。recording は記録点数＋経過秒、playing はループ長＋再生位置、
 * stopped は playing と同内容に停止であることが分かる接頭辞を付けたもの、それ以外
 * （idle・state 未生成）は「記録なし」。
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
  if (s.phase === "stopped") {
    return t("node.automation.stopped", { len: s.loopLenSec.toFixed(1), pos: s.playPosSec.toFixed(1) });
  }
  return t("node.automation.none");
}

/** #270: BeatClock のビートクロック行（TAP ボタン＋ステータス）の領域（params 直下・beatClock 無しは null）。 */
export function beatClockRowRect(
  node: NodeInstance, def: NodeTypeDef,
): { x: number; y: number; w: number; h: number } | null {
  if (!hasBeatClockRow(def)) return null;
  const p = nodePos(node);
  return { x: p.x, y: p.y + TITLE_H + portRows(def) * ROW_H + visibleParamCount(def) * ROW_H, w: NODE_WIDTH, h: ROW_H };
}

/**
 * #270: ビートクロック行を「TAP ボタン」「ステータス表示（ビートインジケータ＋ BPM）」の
 * 2 分割にする（寸法は loopControlLayout のボタン類と同じ感覚: pad 6・gap 6・ボタン幅 54）。
 */
export function beatClockRowLayout(rect: { x: number; y: number; w: number; h: number }): {
  tap: { x: number; y: number; w: number; h: number };
  status: { x: number; y: number; w: number; h: number };
} {
  const pad = 6, gap = 6, tapW = 54;
  const tap = { x: rect.x + pad, y: rect.y + 2, w: tapW, h: rect.h - 4 };
  const status = {
    x: tap.x + tapW + gap, y: rect.y + 2,
    w: rect.w - 2 * pad - tapW - gap, h: rect.h - 4,
  };
  return { tap, status };
}

/** #270: ビートクロック行のステータスラベル。state 未生成（null/undefined）は「BPM --」。 */
export function beatClockStatusLabel(
  s: { bpm: number; phase: number; tapActive: boolean } | null | undefined,
): string {
  if (!s) return t("node.beatclock.none");
  return t("node.beatclock.status", { bpm: s.bpm.toFixed(1) });
}

/** #282: Screen の「⧉ 出力」トグル行の領域（params 直下・screenOutput 無しは null）。 */
export function screenOutputRowRect(
  node: NodeInstance, def: NodeTypeDef,
): { x: number; y: number; w: number; h: number } | null {
  if (!hasScreenOutputRow(def)) return null;
  const p = nodePos(node);
  return { x: p.x, y: p.y + TITLE_H + portRows(def) * ROW_H + visibleParamCount(def) * ROW_H, w: NODE_WIDTH, h: ROW_H };
}

/**
 * #282: 出力トグル行を「⧉ 出力ボタン」「状態ラベル」の 2 分割にする
 * （寸法は beatClockRowLayout と同じ感覚: pad 6・gap 6・ボタン幅 64）。
 */
export function screenOutputRowLayout(rect: { x: number; y: number; w: number; h: number }): {
  button: { x: number; y: number; w: number; h: number };
  status: { x: number; y: number; w: number; h: number };
} {
  const pad = 6, gap = 6, btnW = 64;
  const button = { x: rect.x + pad, y: rect.y + 2, w: btnW, h: rect.h - 4 };
  const status = {
    x: button.x + btnW + gap, y: rect.y + 2,
    w: rect.w - 2 * pad - btnW - gap, h: rect.h - 4,
  };
  return { button, status };
}

/** #282: 出力トグル行の状態ラベル（開いている間は「出力中」・それ以外は「未出力」）。 */
export function screenOutputStatusLabel(open: boolean): string {
  return t(open ? "node.screen.outputOn" : "node.screen.outputOff");
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

/** #205: SamplePad タイトルバー右端の「拡大表示」ボタン領域（⛶）。 */
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

/** #272: MidiPad の押下インジケータ 1 マスの寸法（padGridMetrics と同じ算出）。midiPad 無しは null。 */
export function midiPadGridMetrics(def: NodeTypeDef): {
  rows: number; cols: number; padW: number; padH: number; gap: number; innerW: number;
} | null {
  if (!def.midiPad) return null;
  const { rows, cols } = def.midiPad;
  const innerW = NODE_WIDTH - 2 * PAD_MARGIN_X;
  const padW = (innerW - (cols - 1) * PAD_GAP) / cols;
  return { rows, cols, padW, padH: padW, gap: PAD_GAP, innerW };
}

/** #272: 押下インジケータ全体の高さ（全マス＋ギャップ）。midiPad 無しは 0。 */
export function midiPadGridHeight(def: NodeTypeDef): number {
  const m = midiPadGridMetrics(def);
  if (!m) return 0;
  return m.rows * m.padH + (m.rows - 1) * m.gap;
}

/** #272: params 直下の追加行が始まる y（ノード原点からの相対）。 */
function extraRowTop(def: NodeTypeDef): number {
  return TITLE_H + portRows(def) * ROW_H + visibleParamCount(def) * ROW_H;
}

/** #272: MIDI Learn 行（LEARN ボタン＋割当ステータス）の領域（params 直下・midiLearn 無しは null）。 */
export function midiLearnRowRect(
  node: NodeInstance, def: NodeTypeDef,
): { x: number; y: number; w: number; h: number } | null {
  if (!hasMidiLearnRow(def)) return null;
  const p = nodePos(node);
  return { x: p.x, y: p.y + extraRowTop(def), w: NODE_WIDTH, h: ROW_H };
}

/**
 * #272: MIDI Learn 行を「LEARN ボタン」「割当ステータス」の 2 分割にする
 * （寸法は beatClockRowLayout と同じ感覚: pad 6・gap 6・ボタン幅 54）。
 */
export function midiLearnRowLayout(rect: { x: number; y: number; w: number; h: number }): {
  learn: { x: number; y: number; w: number; h: number };
  status: { x: number; y: number; w: number; h: number };
} {
  const pad = 6, gap = 6, learnW = 54;
  const learn = { x: rect.x + pad, y: rect.y + 2, w: learnW, h: rect.h - 4 };
  const status = {
    x: learn.x + learnW + gap, y: rect.y + 2,
    w: rect.w - 2 * pad - learnW - gap, h: rect.h - 4,
  };
  return { learn, status };
}

/** #272: MIDI Learn 行のステータス表示に必要な情報（実体は各 Midi ランタイムが返す）。 */
export type MidiLearnInfo = MidiLearnDisplay;

/**
 * #272: MIDI Learn 行のステータスラベル。
 * 待機中 → 接続の問題 → 割当内容、の順で優先する（デバイスが無いのに割当だけ出ても
 * 「なぜ効かないのか」が分からないため、接続の問題を先に見せる）。
 */
export function midiLearnStatusLabel(info: MidiLearnInfo | null | undefined): string {
  if (!info) return t("node.midi.starting");
  if (info.waiting) return t("node.midi.learning");
  if (info.status === "unsupported") return t("node.midi.unsupported");
  if (info.status === "denied") return t("node.midi.denied");
  if (info.status === "no-device") return t("node.midi.noDevice");
  if (info.status === "idle" || info.status === "starting") return t("node.midi.starting");
  const ch = info.channel === 0
    ? t("node.midi.omni")
    : t("node.midi.channel", { n: info.channel });
  const key = info.kind === "cc" ? "node.midi.assignedCc" : "node.midi.assignedNote";
  return t(key, { ch, num: info.number });
}

/** #272: MidiPad の押下インジケータ全体の領域（MIDI Learn 行の直下・midiPad 無しは null）。 */
export function midiPadGridRect(
  node: NodeInstance, def: NodeTypeDef,
): { x: number; y: number; w: number; h: number } | null {
  const m = midiPadGridMetrics(def);
  if (!m) return null;
  const p = nodePos(node);
  const learnRow = hasMidiLearnRow(def) ? ROW_H : 0;
  const top = extraRowTop(def) + learnRow + PAD_MARGIN_TOP;
  return { x: p.x + PAD_MARGIN_X, y: p.y + top, w: m.innerW, h: midiPadGridHeight(def) };
}

/** #272: 押下インジケータ 1 マスの領域（index は 0 始まり・範囲外は null）。 */
export function midiPadRect(
  node: NodeInstance, def: NodeTypeDef, index: number,
): { x: number; y: number; w: number; h: number } | null {
  const m = midiPadGridMetrics(def);
  const grid = midiPadGridRect(node, def);
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
