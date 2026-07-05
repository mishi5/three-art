// #242: 操作方法のヘルプポップアップ。上部ツールバー右端の「?」ボタンから開閉する。
// 本文は help-content.ts の helpSections(mode) が生成（#229 の操作モードで差し替え）。
// Esc / 外側クリックで閉じる（#166 closeOnOutside / #228 と同パターン）。
// 見た目は既存のコンテキストメニュー（#16161c・角丸・12px system-ui）に合わせる。
import { helpSections } from "./help-content";
import type { PanSelectMode } from "./pan-policy";

/** テスト・スタイル参照用のルート要素クラス名。 */
export const HELP_POPUP_CLASS = "nv-help-popup";

export class HelpPopup {
  private el: HTMLDivElement | null = null;
  /** 開いたトグルボタン。ボタン上の pointerdown では閉じない（click のトグルに委ねる・#166）。 */
  private anchor: HTMLElement | null = null;

  constructor(
    /** 現在の操作モード（#229）。開くたびに読む（設定パネルの切替を即反映）。 */
    private readonly getMode: () => PanSelectMode,
  ) {}

  isOpen(): boolean {
    return this.el !== null;
  }

  /** ? ボタンのクリックで呼ぶ。開いていれば閉じ、閉じていればアンカー直下に開く。 */
  toggle(anchor: HTMLElement): void {
    if (this.el) this.close();
    else this.open(anchor);
  }

  open(anchor: HTMLElement): void {
    this.close();
    this.anchor = anchor;
    const el = document.createElement("div");
    el.className = HELP_POPUP_CLASS;
    el.style.cssText =
      "position:fixed;z-index:300;background:#16161c;border:1px solid #444;border-radius:6px;" +
      "padding:8px 12px;font:12px system-ui;color:#ddd;box-shadow:0 4px 16px rgba(0,0,0,0.5);" +
      "max-height:80vh;overflow:auto;max-width:min(440px,calc(100vw - 16px));";
    for (const section of helpSections(this.getMode())) {
      const title = document.createElement("div");
      title.textContent = section.title;
      // セクション見出しは既存メニューの addMenuLabel と同トーン。
      title.style.cssText = "color:#666;font-size:10px;letter-spacing:0.5px;padding:6px 0 2px;";
      el.appendChild(title);
      const grid = document.createElement("div");
      grid.style.cssText = "display:grid;grid-template-columns:auto 1fr;gap:2px 10px;";
      for (const item of section.items) {
        const keys = document.createElement("span");
        keys.textContent = item.keys;
        keys.style.cssText = "color:#9fb6d4;white-space:nowrap;";
        const desc = document.createElement("span");
        desc.textContent = item.desc;
        desc.style.cssText = "color:#bbb;";
        grid.append(keys, desc);
      }
      el.appendChild(grid);
    }
    document.body.appendChild(el);
    // アンカー直下・右端揃えで配置（画面左端からはみ出す場合は寄せる）。
    const r = anchor.getBoundingClientRect();
    const w = el.getBoundingClientRect().width;
    el.style.top = `${r.bottom + 4}px`;
    el.style.left = `${Math.max(8, r.right - w)}px`;
    this.el = el;
    // open は click（pointerdown より後）で呼ばれ、アンカー上は onPointerDown が除外するため、
    // #166 のような setTimeout 遅延なしで即購読してよい（自身を開いた操作では閉じない）。
    window.addEventListener("pointerdown", this.onPointerDown, true);
    window.addEventListener("keydown", this.onKeyDown);
  }

  close(): void {
    if (!this.el) return;
    window.removeEventListener("pointerdown", this.onPointerDown, true);
    window.removeEventListener("keydown", this.onKeyDown);
    this.el.remove();
    this.el = null;
    this.anchor = null;
  }

  /** 外側クリックで閉じる。ポップアップ内・アンカー上は対象外（#166 と同じ判定）。 */
  private onPointerDown = (e: Event): void => {
    const t = e.target as Node | null;
    if (!t) return;
    const inside = this.el?.contains(t) ?? false;
    const onAnchor = this.anchor?.contains(t) ?? false;
    if (!inside && !onAnchor) this.close();
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "Escape") this.close();
  };
}
