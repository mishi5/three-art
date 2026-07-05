// #242: ヘルプポップアップの本文データと表示データ生成（純関数）。
// 旧・上部ツールバーの常時表示テキストをここへ移設し、実装（NodeEditor / main.ts）に
// ある実際の操作を漏れなく整理した。#229 の操作モード（modern/legacy）で
// パン/矩形選択の記述を差し替える。
// 注意: ヘルプ文言は必ずこのファイル（＋ i18n カタログ）に集約し、
// 表示側（help-popup.ts / NodeEditor.ts）へハードコードを散在させないこと。
// #244: 文言は i18n カタログのキーで保持し、helpSections 呼び出し時に t() で解決する
// （モジュールロード時に焼き込むと setLang より先に評価され言語が切り替わらないため）。
import type { PanSelectMode } from "./pan-policy";
import { t, type MsgKey } from "../i18n";

/** ヘルプ 1 項目（キー/操作 と説明）。 */
export interface HelpItem {
  keys: string;
  desc: string;
}

/** ヘルプ 1 セクション（見出しと項目の配列）。 */
export interface HelpSection {
  title: string;
  items: HelpItem[];
}

/** カタログキーで保持するヘルプ 1 項目。 */
interface HelpItemDef {
  keys: MsgKey;
  desc: MsgKey;
}

/** #229 modern: 空白左ドラッグ=パン / Shift+左ドラッグ=矩形選択（#207 現行）。 */
const PAN_SELECT_MODERN: HelpItemDef[] = [
  { keys: "help.keys.dragEmpty", desc: "help.desc.pan" },
  { keys: "help.keys.shiftDrag", desc: "help.desc.boxSelect" },
];

/** #229 legacy: 空白左ドラッグ=矩形選択（#207 以前。パンは Space+左・中・右ドラッグ）。 */
const PAN_SELECT_LEGACY: HelpItemDef[] = [
  { keys: "help.keys.dragEmpty", desc: "help.desc.boxSelect" },
  { keys: "help.keys.spaceDrag", desc: "help.desc.pan" },
];

/** モード共通のパン・選択・メニュー操作。 */
const PAN_SELECT_COMMON: HelpItemDef[] = [
  { keys: "help.keys.midRightDrag", desc: "help.desc.panOverNode" },
  { keys: "help.keys.wheelPinch", desc: "help.desc.zoom" },
  { keys: "help.keys.clickEmpty", desc: "help.desc.deselect" },
  { keys: "help.keys.rightClick", desc: "help.desc.contextMenu" },
];

/** ノード・接続の操作（モード共通）。 */
const NODE_WIRE_ITEMS: HelpItemDef[] = [
  { keys: "help.keys.dragNode", desc: "help.desc.moveNode" },
  { keys: "help.keys.cmdClick", desc: "help.desc.toggleSelect" },
  { keys: "help.keys.dragFromOutput", desc: "help.desc.connect" },
  { keys: "help.keys.clickConnectedInput", desc: "help.desc.disconnect" },
  { keys: "help.keys.dragParam", desc: "help.desc.slider" },
  { keys: "help.keys.eyeIcon", desc: "help.desc.nodePreview" },
  { keys: "help.keys.clickPreview", desc: "help.desc.fullscreen" },
];

/** キーボード操作（モード共通）。 */
const KEYBOARD_ITEMS: HelpItemDef[] = [
  { keys: "help.keys.space", desc: "help.desc.panShort" },
  { keys: "help.keys.undo", desc: "help.desc.undoRedo" },
  { keys: "help.keys.delete", desc: "help.desc.deleteSel" },
  { keys: "help.keys.copyPaste", desc: "help.desc.copyPaste" },
  { keys: "help.keys.group", desc: "help.desc.group" },
  { keys: "help.keys.zero", desc: "help.desc.resetZoom" },
  { keys: "help.keys.esc", desc: "help.desc.escClose" },
];

/** カタログキーの項目定義を現在言語の表示文言へ解決する。 */
const resolve = (items: HelpItemDef[]): HelpItem[] =>
  items.map((i) => ({ keys: t(i.keys), desc: t(i.desc) }));

/**
 * ヘルプポップアップの表示データを生成する純関数。
 * 操作モード（#229）に応じてパン/矩形選択の記述を差し替える。
 * 呼び出しごとに新しい配列を返す（呼び出し側での変更が共有されない）。
 */
export function helpSections(mode: PanSelectMode): HelpSection[] {
  const panSelect = mode === "legacy" ? PAN_SELECT_LEGACY : PAN_SELECT_MODERN;
  return [
    { title: t("help.section.panSelect"), items: resolve([...panSelect, ...PAN_SELECT_COMMON]) },
    { title: t("help.section.nodeWire"), items: resolve(NODE_WIRE_ITEMS) },
    { title: t("help.section.keyboard"), items: resolve(KEYBOARD_ITEMS) },
  ];
}
