// #230: サイドドック「コントロール」パネル。下部バーに並んでいた全コントロール
// （入力開始/停止・出力ウィンドウ・録画・音声デバイス・グラフ/プロジェクト保存読込）を
// 機能グループのセクションで縦に並べる。各セクションの中身（ボタン生成・配線）は
// 呼び出し側が mount で構築する（settings-panel と同じ「ドックは枠だけ」パターン）。
import type { SidePanelDef } from "./side-dock";

const ICON = (body: string): string =>
  `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
  `stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
// スライダー（ミキサー）アイコン。
const SLIDERS_ICON = ICON(
  '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/>' +
  '<line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/>' +
  '<line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/>' +
  '<line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/>' +
  '<line x1="17" y1="16" x2="23" y2="16"/>',
);

/** コントロールパネルの 1 セクション（見出し + 内容の構築は呼び出し側）。 */
export interface ControlsSection {
  title: string;
  mount(host: HTMLElement): void; // 内容をセクションの host に構築（1 度だけ呼ばれる）
}

/** コントロールパネルのサイドドック定義。 */
export function controlsPanelDef(sections: ControlsSection[]): SidePanelDef {
  return {
    id: "controls",
    title: "コントロール",
    icon: SLIDERS_ICON,
    mount: (host) => mountControlsPanel(host, sections),
  };
}

function mountControlsPanel(host: HTMLElement, sections: ControlsSection[]): void {
  const body = document.createElement("div");
  body.style.cssText = "display:flex;flex-direction:column;gap:8px;overflow-y:auto;flex:1 1 auto;";
  host.appendChild(body);
  for (const s of sections) {
    // セクション見出し（settings-panel と同スタイル）。
    const heading = document.createElement("div");
    heading.textContent = s.title;
    heading.style.cssText = "color:#9ab;font-size:11px;font-weight:600;padding:2px 2px 0;";
    body.appendChild(heading);
    // セクション内容の host（縦積み）。
    const box = document.createElement("div");
    box.style.cssText = "display:flex;flex-direction:column;gap:6px;";
    body.appendChild(box);
    s.mount(box);
  }
}
