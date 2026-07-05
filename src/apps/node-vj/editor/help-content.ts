// #242: ヘルプポップアップの本文データと表示データ生成（純関数）。
// 旧・上部ツールバーの常時表示テキストをここへ移設し、実装（NodeEditor / main.ts）に
// ある実際の操作を漏れなく整理した。#229 の操作モード（modern/legacy）で
// パン/矩形選択の記述を差し替える。
// 注意（#244 で UI 文言を i18n 化予定）: ヘルプ文言は必ずこのファイルに集約し、
// 表示側（help-popup.ts / NodeEditor.ts）へハードコードを散在させないこと。
import type { PanSelectMode } from "./pan-policy";

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

/** #229 modern: 空白左ドラッグ=パン / Shift+左ドラッグ=矩形選択（#207 現行）。 */
const PAN_SELECT_MODERN: HelpItem[] = [
  { keys: "空白を左ドラッグ", desc: "パン（表示位置の移動）" },
  { keys: "Shift+左ドラッグ", desc: "矩形選択" },
];

/** #229 legacy: 空白左ドラッグ=矩形選択（#207 以前。パンは Space+左・中・右ドラッグ）。 */
const PAN_SELECT_LEGACY: HelpItem[] = [
  { keys: "空白を左ドラッグ", desc: "矩形選択" },
  { keys: "Space+左ドラッグ", desc: "パン（表示位置の移動）" },
];

/** モード共通のパン・選択・メニュー操作。 */
const PAN_SELECT_COMMON: HelpItem[] = [
  { keys: "中・右ドラッグ", desc: "パン（ノード上でも可）" },
  { keys: "ホイール / ピンチ", desc: "ズーム（カーソル中心）" },
  { keys: "空白を左クリック", desc: "選択解除" },
  { keys: "右クリック", desc: "コンテキストメニュー（空白: ノード・ラベル追加 / ノード上: 複製・削除・名前編集）" },
];

/** ノード・接続の操作（モード共通）。 */
const NODE_WIRE_ITEMS: HelpItem[] = [
  { keys: "ノードを左ドラッグ", desc: "移動（グループ所属はグループごと移動）" },
  { keys: "Cmd/Ctrl+クリック", desc: "選択に追加 / 除外" },
  { keys: "出力ポートからドラッグ", desc: "接続（param 行へのドロップでも接続）" },
  { keys: "接続済み入力ポートをクリック", desc: "切断（ドラッグで別ポートへ付け替え）" },
  { keys: "param 行を左右ドラッグ", desc: "スライダ編集（クリックで数値入力）" },
  { keys: "タイトル右端の 👁", desc: "ノードプレビュー小窓の表示切替" },
  { keys: "右下プレビューをクリック", desc: "全画面表示の切替（Esc で解除）" },
];

/** キーボード操作（モード共通）。 */
const KEYBOARD_ITEMS: HelpItem[] = [
  { keys: "Space（押しながらドラッグ）", desc: "パン" },
  { keys: "Cmd+Z / Shift+Cmd+Z", desc: "元に戻す / やり直し" },
  { keys: "Delete / Backspace", desc: "選択ノード・ラベルを削除" },
  { keys: "Cmd+C / Cmd+V", desc: "コピー / マウス位置へ貼り付け" },
  { keys: "Cmd+G / Shift+Cmd+G", desc: "グループ化 / グループ解除" },
  { keys: "0", desc: "ズームを 100% に戻す" },
  { keys: "Esc", desc: "プレビュー全画面・ポップアップを閉じる" },
];

/** セクション見出し。 */
const TITLE_PAN_SELECT = "マウス（パン・選択）";
const TITLE_NODE_WIRE = "マウス（ノード・接続）";
const TITLE_KEYBOARD = "キーボード";

/**
 * ヘルプポップアップの表示データを生成する純関数。
 * 操作モード（#229）に応じてパン/矩形選択の記述を差し替える。
 * 呼び出しごとに新しい配列を返す（呼び出し側での変更が共有されない）。
 */
export function helpSections(mode: PanSelectMode): HelpSection[] {
  const panSelect = mode === "legacy" ? PAN_SELECT_LEGACY : PAN_SELECT_MODERN;
  return [
    { title: TITLE_PAN_SELECT, items: [...panSelect, ...PAN_SELECT_COMMON].map((i) => ({ ...i })) },
    { title: TITLE_NODE_WIRE, items: NODE_WIRE_ITEMS.map((i) => ({ ...i })) },
    { title: TITLE_KEYBOARD, items: KEYBOARD_ITEMS.map((i) => ({ ...i })) },
  ];
}
